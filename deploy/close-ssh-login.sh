#!/usr/bin/env bash
# Closes SSH to passwords and root login (ADR-002, DV-35). Run it as admin with sudo, from a
# second session, only after setup-server.sh has run and you have confirmed that admin can log in
# with its key and that 'sudo -n true' works:
#
#   sudo bash close-ssh-login.sh
#
# It refuses to run unless admin has a key and the sudoers file written by setup-server.sh. That
# only catches a missing key, not a wrong one, so do the login check above first. Idempotent:
# running it again changes nothing.
set -euo pipefail

ADMIN_USER="admin"
CONF="/etc/ssh/sshd_config.d/10-farol-hardening.conf"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root, with sudo: sudo bash $0" >&2
  exit 1
fi
if [[ ! -s "/home/$ADMIN_USER/.ssh/authorized_keys" ]]; then
  echo "Refusing: /home/$ADMIN_USER/.ssh/authorized_keys is missing or empty. Run setup-server.sh first." >&2
  exit 1
fi
if [[ ! -f /etc/sudoers.d/90-farol-admin ]]; then
  echo "Refusing: /etc/sudoers.d/90-farol-admin is missing, so $ADMIN_USER may not have sudo. Run setup-server.sh first." >&2
  exit 1
fi

# Keep the previous file outside sshd_config.d (sshd never reads it) so a failed check can restore it.
PREVIOUS=""
if [[ -e "$CONF" ]]; then
  PREVIOUS="$(mktemp)"
  cp -p "$CONF" "$PREVIOUS"
fi

cat >"$CONF" <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
SSHD
if ! sshd -t; then
  if [[ -n "$PREVIOUS" ]]; then
    cp -p "$PREVIOUS" "$CONF"
    rm -f "$PREVIOUS"
    echo "sshd -t failed; restored the previous $CONF and left SSH login settings unchanged." >&2
  else
    rm -f "$CONF"
    echo "sshd -t failed; removed $CONF and left SSH login settings unchanged." >&2
  fi
  exit 1
fi
[[ -z "$PREVIOUS" ]] || rm -f "$PREVIOUS"
# ssh.service is socket-activated on some Ubuntu releases and may be inactive; this does not fail then.
systemctl try-reload-or-restart ssh

echo "SSH is now key only and root login is closed. Keep this session open and, from another one,"
echo "confirm that 'ssh -i <admin key> $ADMIN_USER@<server>' still works."
