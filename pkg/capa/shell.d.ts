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
  const mixin: any;
  export default mixin;
}

declare module '@shell/utils/error' {
  export function stringify(err: unknown): string;
  export function exceptionToErrorsArray(err: unknown): string[];
  export function formatAWSError(err: unknown): unknown;
  export function createDoNotLogError(message: string): Error;
  export function isDoNotLogError(err: unknown): boolean;
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

declare module '@shell/config/query-params' {
  export const _CREATE: string;
}
