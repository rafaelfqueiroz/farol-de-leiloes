// A browser's cookie jar, as small as the BFF tests need (SC-02, BR-001-18): it applies the
// `Set-Cookie` headers of real route-handler responses and builds the `Cookie` header of the next
// request, so a test can say what the browser holds after a sequence of answers that arrive in
// an order the server could not see.

export class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** Applies every `Set-Cookie` of the response: a value stores it, `Max-Age=0` removes it. */
  apply(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair = '', ...attributes] = header.split(';').map((part) => part.trim());
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      const expired = attributes.some((attribute) => /^max-age=0+$/i.test(attribute));
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  /** The value the browser holds under `name`, or undefined. */
  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  /** The `Cookie` header the browser sends now ('' when the jar is empty). */
  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}
