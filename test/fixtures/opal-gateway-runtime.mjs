/** Channel-aware runtime fixture; each mock has an independent real scheduler. */
import { OpalCoordinator } from '../../src/opal/coordinator.ts';
export function gatewayRuntime(previous = (_message, callback) => callback?.({ ok: true, data: {} })) {
    const coordinator = new OpalCoordinator();
    return { id: 'test', lastError: null, sendMessage(message, callback) {
        if (message.channel === 'opal-gateway-v1') callback(coordinator.handle(message.command));
        else previous(message, callback);
    } };
}
