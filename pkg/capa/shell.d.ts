declare module '@shell/store/plugins' {
  export function mapDriver(name: string, to: string): void;
}

declare module '@shell/store/store-types' {
  export const BLANK_CLUSTER: string;
}

declare module '@shell/utils/kube' {
  export function normalizeName(str: string): string;
}

declare module '@shell/utils/string' {
  export function pluralize(value: string, count?: number): string;
}

declare module '@shell/config/types' {
  export const DEFAULT_WORKSPACE: string;
  export const NORMAN: {
    CLOUD_CREDENTIAL: string;
    [key: string]: string;
  };
  export const MANAGEMENT: {
    SETTING: string;
    [key: string]: string;
  };
}

declare module '@shell/config/product/explorer.js' {
  export const NAME: string;
}

declare module '@shell/config/product/manager.js' {
  export const NAME: string;
}

declare module '@shell/config/product/settings.js' {
  export const NAME: string;
}

declare module '@shell/config/product/auth.js' {
  export const NAME: string;
}

declare module '@shell/components/Loading' {
  const component: any;
  export default component;
}

declare module '@shell/components/EmptyProductPage.vue' {
  const component: any;
  export default component;
}

declare module '@shell/mixins/create-edit-view' {
  const mixin: import('vue').DefineComponent<{}, {}, { value: any; errors: any[]; mode: string }>;
  export default mixin;
}

declare module '@shell/components/form/LabeledSelect' {
  const component: any;
  export default component;
}

declare module '@shell/components/form/UnitInput' {
  const component: any;
  export default component;
}

declare module '@shell/components/form/KeyValue' {
  const component: any;
  export default component;
}

declare module '@shell/components/form/ArrayList.vue' {
  const component: any;
  export default component;
}

declare module '@components/RcSection' {
  export const RcSection: any;
}

declare module '@components/Form/LabeledInput' {
  export const LabeledInput: any;
}

declare module '@components/Form/Checkbox' {
  export const Checkbox: any;
}

declare module '@components/Form/Radio' {
  export const RadioGroup: any;
  export const Radio: any;
}

declare module '@shell/utils/promise' {
  export function allHash(hash: Record<string, any>): Promise<Record<string, any>>;
}

declare module '@shell/plugins/dashboard-store/normalize' {
  export function handleConflict(...args: any[]): any;
}

declare module '@shell/utils/error' {
  export function stringify(err: unknown): string;
  export function exceptionToErrorsArray(err: unknown): string[];
  export function formatAWSError(err: unknown): unknown;
  export function createDoNotLogError(message: string): Error;
  export function isDoNotLogError(err: unknown): boolean;
}

declare module '@shell/utils/object' {
  export function set(obj: any, path: string, value: any): void;
  export function diff(from: any, to: any): any;
  export function isEmpty(obj: any): boolean;
  export function isEqual(a: any, b: any): boolean;
  export function convertStringToKV(str: string): Record<string, string>;
  export function convertKVToString(obj: Record<string, string>): string;
}

declare module '@shell/plugins/dashboard-store/actions' {
  export const _MULTI: string;
}

declare module '@shell/pages/c/_cluster/_product/_resource/index.vue' {
  const component: any;
  export default component;
}

declare module '@shell/pages/c/_cluster/_product/_resource/create.vue' {
  const component: any;
  export default component;
}

declare module '@shell/pages/c/_cluster/_product/_resource/_id.vue' {
  const component: any;
  export default component;
}

declare module '@shell/pages/c/_cluster/_product/_resource/_namespace/_id.vue' {
  const component: any;
  export default component;
}

declare module '@components/Banner' {
  export const Banner: any;
}

declare module 'lodash/merge' {
  export default function merge<TObject>(object: TObject, ...sources: any[]): TObject & Record<string, any>;
}

declare module 'lodash/isEqual' {
  export default function isEqual(value: any, other: any): boolean;
}

declare module 'js-yaml';

declare module '@shell/config/elemental-types' {
  export const KIND: { MACHINE_INV_SELECTOR_TEMPLATES: string };
}

declare module '@shell/config/query-params' {
  export const _CREATE: string;
}
