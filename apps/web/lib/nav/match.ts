/**
 * The nav's shapes and path matching, with no imports: the rail and the module tabs are
 * Client Components, and importing `modules.ts` from them would ship the whole resource
 * registry to the browser. `modules.ts` builds these; this file only reads them.
 */
export interface NavTab {
  href: string;
  label: string;
}

export interface NavModule {
  key: string;
  label: string;
  /** The module's first tab this role can see: where the rail item goes. */
  href: string;
  tabs: NavTab[];
  also: string[];
}

export interface NavSection {
  heading: string;
  modules: NavModule[];
}

/** Whether `pathname` is `href` or a screen beneath it. "/" matches only itself. */
export function isWithin(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function activeModule(pathname: string, sections: NavSection[]): NavModule | undefined {
  for (const section of sections) {
    for (const mod of section.modules) {
      if ([...mod.tabs.map((tab) => tab.href), ...mod.also].some((href) => isWithin(pathname, href))) {
        return mod;
      }
    }
  }
  return undefined;
}
