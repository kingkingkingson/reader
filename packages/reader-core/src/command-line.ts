/** Whether the `reader` command is on the user's PATH, from the desktop shell. */
export interface CommandLineStatus {
  /** False in development builds and on platforms without an installer. */
  supported: boolean;
  installed: boolean;
  /** The link (macOS) or PATH directory (Windows) that provides `reader`. */
  location: string;
  /** Another program already uses the location; Reader leaves it alone. */
  conflict?: boolean;
}
