import { registerWebModule, NativeModule } from "expo";

/**
 * Web stub. It exists so a web bundle can RESOLVE the import, not so it can work.
 *
 * Both methods throw rather than returning false. A false would be indistinguishable from a
 * wrong PIN and would let a web build present a working-looking sign-in that refuses every
 * correct PIN -- a silent wrong answer, which is the failure mode this project treats as
 * worse than a loud one.
 *
 * There is no real web target: parent spec §3 puts collectors on Android 13+ LGU-issued
 * tablets, and §4's architecture table gives the web to admin and supervision, which
 * authenticates through Google Sign-In and never through a collector PIN.
 */
class CeedoBcryptModule extends NativeModule<Record<string, never>> {
  verify(): boolean {
    throw new Error(
      "CeedoBcrypt is Android-only. Collector PIN sign-in has no web target: the web app " +
        "authenticates staff through Google Sign-In (parent spec §11.5).",
    );
  }

  costOf(): number {
    throw new Error("CeedoBcrypt is Android-only.");
  }
}

export default registerWebModule(CeedoBcryptModule, "CeedoBcryptModule");
