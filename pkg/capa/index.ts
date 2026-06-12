import { importTypes } from '@rancher/auto-import';
import { IExtension } from '@shell/core/types';
import { CAPAProvisioner } from './provisioner';

// Init the package
export default function(plugin: IExtension): void {
  // Auto-import model, detail, edit from the folders
  importTypes(plugin);

  // Provide plugin metadata from package.json
  plugin.metadata = require('./package.json');

  // Register custom provisioner object
  plugin.register('provisioner', CAPAProvisioner.ID, CAPAProvisioner);

  // Built-in icon
  plugin.metadata.icon = require('./assets/amazonecapa.svg');
  // Register machine config component
  plugin.register('machine-config', CAPAProvisioner.ID, () => import('./machine-config/capa.vue'));
}
