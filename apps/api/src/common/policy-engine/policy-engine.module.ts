// PolicyEngineModule — registers Cedar+OPA WASM evaluators with the
// process-wide policy engine factory at AppModule init.
//
// Why a Nest module rather than a top-of-file import in `app.module.ts`:
// the WASM modules are heavy (Cedar ~3 MB, OPA ~1 MB) and we lazy-load
// them only when an operator opts into Cedar/OPA. The `enabled` set
// comes from `CERNIQ_POLICY_ENGINES` env (`builtin,cedar,opa` default
// `builtin`). Modules registered here are wired in `app.module.ts`'s
// `imports`.

import { Module, OnModuleInit, Logger } from '@nestjs/common';

import { AppConfigModule } from '../../config/config.module';
import { AppConfigService } from '../../config/config.service';

import { CedarWasmEvaluator } from './cedar-wasm.evaluator';
import { OpaWasmEvaluator } from './opa-wasm.evaluator';

import { registerCedarEvaluator, registerOpaEvaluator } from './index';

@Module({
  imports: [AppConfigModule],
})
export class PolicyEngineModule implements OnModuleInit {
  private readonly logger = new Logger(PolicyEngineModule.name);

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    const raw = (this.config as unknown as { policyEngines?: string }).policyEngines ?? 'builtin';
    const enabled = new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );

    if (enabled.has('cedar')) {
      try {
        registerCedarEvaluator(new CedarWasmEvaluator());
        this.logger.log('CedarWasmEvaluator registered');
      } catch (err) {
        this.logger.warn(`Cedar engine NOT available: ${(err as Error).message}`);
      }
    }
    if (enabled.has('opa')) {
      try {
        registerOpaEvaluator(new OpaWasmEvaluator());
        this.logger.log('OpaWasmEvaluator registered');
      } catch (err) {
        this.logger.warn(`OPA engine NOT available: ${(err as Error).message}`);
      }
    }

    if (enabled.size === 0 || (enabled.size === 1 && enabled.has('builtin'))) {
      this.logger.log('PolicyEngineModule: only builtin engine enabled (default)');
    }
  }
}
