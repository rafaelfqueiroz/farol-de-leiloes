#!/usr/bin/env bash
# One-time provisioning of the production VPS (ADR-002, DV-35). Fresh Ubuntu LTS, run once by the
# owner as root:
#
#   bash setup-server.sh "<admin public key>" "<deploy public key>"
#
# Two users are created, both key-only (the same key may be passed twice):
#   admin  - the owner: sudo without a password (it has no password), edits /etc/farol, runs apt.
#   deploy - used by the deploy job: docker group only, no sudo. Docker group membership is
#            root-equivalent (a container can mount the host), so guard the deploy key accordingly.
# SSH login settings are left untouched: root and password login stay open until the owner has
# proven that admin can log in and use sudo, then runs close-ssh-login.sh (copy it to the server
# together with this script).
#
# The arguments are PUBLIC keys. The script is idempotent: running it again
# changes nothing that is already in place. It holds no secret: the runtime env files in /etc/farol
# are created empty and filled by hand (SC-16), see docs/runbooks/deploy-and-rollback.md.
#
# Docker-published ports bypass ufw (Docker writes its own iptables rules), so the firewall below
# does not protect a container that publishes a port. That is why only Caddy publishes ports in
# compose.production.yml.
set -euo pipefail

DEPLOY_USER="deploy"
ADMIN_USER="admin"
ADMIN_KEY="${1:-}"
DEPLOY_KEY="${2:-}"
KEY_PATTERN='^(ssh-(ed25519|rsa)|ecdsa-sha2-nistp[0-9]+|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/=]+'

if [[ $EUID -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi
if [[ ! "$ADMIN_KEY" =~ $KEY_PATTERN || ! "$DEPLOY_KEY" =~ $KEY_PATTERN ]]; then
  echo "Usage: $0 \"<admin public SSH key>\" \"<deploy public SSH key>\"" >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive

# Docker may already be installed, but ufw and unattended-upgrades below still need fresh lists.
apt-get update

# Creates the user if missing and makes its authorized_keys contain the given key.
ensure_user_with_key() {
  local user="$1" key="$2" ssh_dir="/home/$1/.ssh"
  if ! id "$user" >/dev/null 2>&1; then
    # Some provider images ship a group with this name (an empty `admin` on
    # Hostinger's Ubuntu 26.04) and adduser refuses to create the user over it.
    if getent group "$user" >/dev/null; then
      adduser --disabled-password --gecos "" --ingroup "$user" "$user"
    else
      adduser --disabled-password --gecos "" "$user"
    fi
  fi
  install -d -m 700 -o "$user" -g "$user" "$ssh_dir"
  touch "$ssh_dir/authorized_keys"
  grep -qxF "$key" "$ssh_dir/authorized_keys" || echo "$key" >>"$ssh_dir/authorized_keys"
  chown "$user:$user" "$ssh_dir/authorized_keys"
  chmod 600 "$ssh_dir/authorized_keys"
}

echo "==> Docker Engine and Compose plugin (Docker's official apt repository)"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck source=/dev/null
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> Users: '$ADMIN_USER' (sudo) and '$DEPLOY_USER' (docker group only)"
ensure_user_with_key "$ADMIN_USER" "$ADMIN_KEY"
usermod -aG sudo "$ADMIN_USER"
SUDOERS_TMP="$(mktemp)"
echo "$ADMIN_USER ALL=(ALL) NOPASSWD:ALL" >"$SUDOERS_TMP"
chmod 440 "$SUDOERS_TMP"
visudo -cf "$SUDOERS_TMP"
install -m 440 -o root -g root "$SUDOERS_TMP" /etc/sudoers.d/90-farol-admin
rm -f "$SUDOERS_TMP"
ensure_user_with_key "$DEPLOY_USER" "$DEPLOY_KEY"
usermod -aG docker "$DEPLOY_USER"

echo "==> Firewall (ufw): SSH, 80/tcp, 443/tcp, 443/udp only"
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> Automatic security updates"
apt-get install -y unattended-upgrades
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' >/etc/apt/apt.conf.d/20auto-upgrades

echo "==> /etc/farol: runtime env files, outside the repository (SC-16)"
install -d -m 750 -o root -g "$DEPLOY_USER" /etc/farol
for f in backend.env frontend.env caddy.env; do
  [[ -e "/etc/farol/$f" ]] || touch "/etc/farol/$f"
  chown "root:$DEPLOY_USER" "/etc/farol/$f"
  chmod 640 "/etc/farol/$f"
done
install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /srv/farol

echo "Done. SSH login is still open: this script does not change it."
echo "Next, from your machine, open a second session: ssh -i <admin key> $ADMIN_USER@<server>"
echo "and confirm 'sudo -n true' works there. Then, from that session, close password and root login:"
echo "  sudo bash close-ssh-login.sh"
echo "The deploy job connects as $DEPLOY_USER."
