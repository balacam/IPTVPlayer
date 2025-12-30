
// Detect the current platform
export const isElectron = () => {
    return window && window.electronAPI;
};

export const isCapacitor = () => {
    return window.Capacitor !== undefined;
};

export const isWeb = () => {
    return !isElectron() && !isCapacitor();
};

export const getPlatform = () => {
    if (isElectron()) return 'electron';
    if (isCapacitor()) return 'capacitor';
    return 'web';
};
