/** Shared by the Edge middleware and Node routes; never expose the password. */
export function hasCredentials(req: Request, password: string): boolean {
  if (!password) return false;
  if (req.headers.get('x-supplysaathi-auth') === password) return true;
  const token = (req.headers.get('cookie') ?? '').match(/(?:^|;\s*)ss_auth=([^;]+)/)?.[1];
  if (token === password) return true;
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Basic ')) return false;
  try {
    const decoded = atob(authorization.slice(6));
    return decoded.slice(decoded.indexOf(':') + 1) === password && decoded.includes(':');
  } catch { return false; }
}
