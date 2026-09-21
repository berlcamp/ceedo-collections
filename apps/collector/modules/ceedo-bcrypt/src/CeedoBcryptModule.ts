import { NativeModule, requireNativeModule } from "expo";

declare class CeedoBcryptModule extends NativeModule<Record<string, never>> {
  /**
   * Verifies a PIN against a `$2a$` bcrypt hash. Synchronous. Returns false rather than
   * throwing for a malformed or empty hash.
   */
  verify(pin: string, hash: string): boolean;

  /** The cost factor encoded in a hash, or -1 if it cannot be read. */
  costOf(hash: string): number;
}

export default requireNativeModule<CeedoBcryptModule>("CeedoBcrypt");
