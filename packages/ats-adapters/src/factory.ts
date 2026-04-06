import { ATSAdapter } from "./adapter";
import { GreenhouseAdapter } from "./adapters/greenhouse";
import { LeverAdapter } from "./adapters/lever";
import { AshbyAdapter } from "./adapters/ashby";
import { RipplingAdapter } from "./adapters/rippling";
import { GenericHTMLAdapter } from "./adapters/generic-html";
import { PlaywrightCareersAdapter } from "./adapters/playwright-careers";
import { MicrosoftPcsxAdapter } from "./adapters/microsoft-pcsx";
import { MetaGraphqlAdapter } from "./adapters/meta-graphql";

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
