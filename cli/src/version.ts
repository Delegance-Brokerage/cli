/** Kept equal to package.json "version"; a unit test fails on drift. */
export const CLI_VERSION = '0.3.4';

/**
 * Passed as `headers` to every SDK client the CLI builds. The SDK sends
 * `X-Delegance-Client: sdk/<version>` by default; this names the CLI instead,
 * so the server can tell CLI traffic apart and gate a broken CLI release.
 */
export const CLI_CLIENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-Delegance-Client': `cli/${CLI_VERSION}`,
});
