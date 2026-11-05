import { IPlugin } from '@shell/core/types';
import extension from '../index';
import packageJson from '../package.json';
import { CAPAProvisioner } from '../provisioner';
import { CAPARKE2Cluster } from '../model-extension/provisioning.cattle.io.cluster';

/**
 * Stands in for the dashboard's extension manager.
 *
 * Any method your index.ts calls - addProduct, addRoutes, addPanel, addTableColumn, ... - is
 * answered with a jest mock the first time it is read, so this keeps working as you register
 * more things. Assert against them with `expect(plugin.addProduct).toHaveBeenCalledWith(...)`.
 */
const mockPlugin = (): IPlugin => {
  const mocks: Record<string | symbol, unknown> = {};

  return new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) {
        return target[prop];
      }

      mocks[prop] = mocks[prop] || jest.fn();

      return mocks[prop];
    }
  }) as unknown as IPlugin;
};

describe('extension entry point', () => {
  it('should expose the package.json metadata to the dashboard', () => {
    const plugin = mockPlugin();

    extension(plugin);

    expect(plugin.metadata).toStrictEqual(packageJson);
  });

  it('should register the CAPA provisioner', () => {
    const plugin = mockPlugin();

    extension(plugin);

    expect(plugin.register).toHaveBeenCalledWith('provisioner', 'awsmachinetemplate', CAPAProvisioner);
  });

  it('should register a lazily-loaded machine config component', async() => {
    const plugin = mockPlugin();

    extension(plugin);

    const call = (plugin.register as jest.Mock).mock.calls.find(([type]) => type === 'machine-config');

    expect(call?.[1]).toBe('awsmachinetemplate');

    const component = await call?.[2]();

    expect(component.default.name).toBe('MachineConfigCapa');
  });

  it('should register the provisioning cluster model extension', () => {
    const plugin = mockPlugin();

    extension(plugin);

    expect(plugin.addModelExtension).toHaveBeenCalledWith('provisioning.cattle.io.cluster', CAPARKE2Cluster);
  });
});
