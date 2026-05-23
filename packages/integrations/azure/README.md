# @aegis/azure — AEGIS adapters for Azure

**Pattern:** C — Cloud function adapter
**Status:** Stub
**Claim hook:** `aegis:int-azure`
**Target npm name:** `@aegis/azure`

## What it does

Three Azure surfaces in one package:

1. **Azure Functions binding** — `aegisFunctionsWrapper(handler, config)`. Verifies AEGIS before delegating to the function handler.
2. **Logic Apps connector** — Swagger/OpenAPI definition + auth manifest so a custom connector can be deployed into Azure Logic Apps.
3. **Azure OpenAI Service wrapper** — `withAegisVerification(azureClient, config)`. Same shape as `@aegis/openai` (which the Azure client is API-compatible with) but binds the principal to Microsoft Entra ID by default.

## Surface

```ts
import { aegisFunctionsWrapper } from '@aegis/azure';
import { Aegis } from '@aegis/sdk';

const aegis = new Aegis({ apiKey: process.env.AEGIS_KEY });

export default aegisFunctionsWrapper(async (req) => {
  return { body: await processAction(req) };
}, {
  aegis,
  actionResolver: (req) => req.body?.action,
  agentTokenResolver: (req) => req.headers?.['x-aegis-token'],
  // Bind principal to Entra ID identity if EasyAuth is configured
  principalResolver: (req) => req.headers?.['x-ms-client-principal-name'],
});
```

## Why this matters

Azure is the second largest enterprise cloud. Azure OpenAI Service is the procurement-preferred LLM gateway for enterprises with Microsoft 365 + Entra ID. Functions + Logic Apps cover both serverless and no-code orchestration. This package gives AEGIS the Azure enterprise story.

## Implementation notes

- Azure OpenAI client is API-compatible with OpenAI SDK; the wrapper can largely delegate to `@aegis/openai`.
- Entra ID principal binding requires reading the `x-ms-client-principal` header populated by EasyAuth.
- Logic Apps custom connector ships as a separate artifact (Swagger 2.0 + connector manifest).

## TODO

- [ ] `aegisFunctionsWrapper`
- [ ] Logic Apps connector manifest + Swagger
- [ ] Azure OpenAI wrapper (delegating to @aegis/openai)
- [ ] Entra ID principal binding
- [ ] Tests with `@azure/functions` mock
- [ ] Example function + example Logic App
