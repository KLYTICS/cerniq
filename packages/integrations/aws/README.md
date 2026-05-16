# @aegis/aws — AEGIS adapters for AWS

**Pattern:** C — Cloud function adapter (+ Pattern D for audit sink)
**Status:** Stub
**Claim hook:** `aegis:int-aws`
**Target npm name:** `@aegis/aws`

## What it does

Three AWS surfaces in one package:

1. **Lambda middleware** — `aegisLambdaWrapper(handler, config)`. Verifies AEGIS before delegating to the handler. Works with API Gateway, Function URLs, and direct invokes.
2. **EventBridge sink** — `eventBridgeAuditSink(busName)`. Streams AEGIS-signed audit events into an EventBridge bus for fan-out to CloudWatch, Lambda, Step Functions, SQS, or any other EventBridge target.
3. **Bedrock Agents action-group wrapper** — `bedrockAgentVerifier(config)`. Verifies before each Bedrock Agent action-group invocation.

## Surface

```ts
import { aegisLambdaWrapper, eventBridgeAuditSink, bedrockAgentVerifier } from '@aegis/aws';
import { Aegis } from '@aegis/sdk';

const aegis = new Aegis({ apiKey: process.env.AEGIS_KEY });

export const handler = aegisLambdaWrapper(myHandler, {
  aegis,
  actionResolver: (event) => event.body?.action,
  agentTokenResolver: (event) => event.headers?.['x-aegis-token'],
  onDenial: (reason) => ({ statusCode: 403, body: JSON.stringify({ denied: reason }) }),
});
```

```ts
// In your audit-event subscriber lambda:
const sink = eventBridgeAuditSink('aegis-audit-bus');
await sink.export(signedEvents);
```

```ts
// In your Bedrock action group lambda:
export const handler = bedrockAgentVerifier({
  aegis,
  actionPrefix: 'bedrock.',
})(myActionGroupHandler);
```

## Why this matters

AWS is the dominant enterprise cloud. Lambda is where most enterprise agent actions execute. EventBridge is the canonical event spine. Bedrock is AWS's bet on the agent layer. Covering all three with one package gives AEGIS the enterprise-cloud story in one snap-in.

## Implementation notes

- Edge-safe (no Node-only deps beyond AWS SDK v3 if needed for EventBridge).
- IAM permissions doc lists exact policies each surface requires.
- Lambda extensions vs middleware: stick with middleware; extensions are over-engineered for our verify path.

## TODO

- [ ] `aegisLambdaWrapper`
- [ ] `eventBridgeAuditSink`
- [ ] `bedrockAgentVerifier`
- [ ] IAM policy docs
- [ ] Example SAM / CDK templates
- [ ] Tests with `aws-sdk-client-mock`
