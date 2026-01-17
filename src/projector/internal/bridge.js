export const getBridge = () => globalThis.nwWrldBridge;

export const getMessaging = () => getBridge()?.messaging;

