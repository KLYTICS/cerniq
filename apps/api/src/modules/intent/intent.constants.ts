// DI symbols + env flag names for the intent module. Keep small.

export const INTENT_PORTS = Symbol('INTENT_PORTS');

export const AEGIS_INTENT_MANIFEST_ENABLED_ENV = 'AEGIS_INTENT_MANIFEST_ENABLED';
export const AEGIS_INTENT_MANIFEST_STORAGE_ENV = 'AEGIS_INTENT_MANIFEST_STORAGE'; // 'memory' | 'prisma'
