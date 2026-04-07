import { ATSAdapter } from "./adapter.js";
import { GreenhouseAdapter } from "./adapters/greenhouse.js";
import { LeverAdapter } from "./adapters/lever.js";
import { AshbyAdapter } from "./adapters/ashby.js";
import { RipplingAdapter } from "./adapters/rippling.js";
import { GenericHTMLAdapter } from "./adapters/generic-html.js";
import { PlaywrightCareersAdapter } from "./adapters/playwright-careers.js";
import { MicrosoftPcsxAdapter } from "./adapters/microsoft-pcsx.js";
import { MetaGraphqlAdapter } from "./adapters/meta-graphql.js";

const adapters: Record<string, () => ATSAdapter> = {
  greenhouse: () => new GreenhouseAdapter(),
  lever: () => new LeverAdapter(),
  ashby: () => new AshbyAdapter(),
  rippling: () => new RipplingAdapter(),
  custom: () => new GenericHTMLAdapter(),
  playwright: () => new PlaywrightCareersAdapter(),
  microsoft_pcsx: () => new MicrosoftPcsxAdapter(),
  meta_graphql: () => new MetaGraphqlAdapter(),
};

export function createAdapter(atsType: string): ATSAdapter {
  const factory = adapters[atsType];
  if (!factory) {
    throw new Error(`Unsupported ATS type: ${atsType}. Supported: ${Object.keys(adapters).join(", ")}`);
  }
  return factory();
}
