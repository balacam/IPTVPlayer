// Platform detection - Android TV only
export const isCapacitor = () => {
    return window.Capacitor !== undefined;
};

export const getPlatform = () => {
    return 'android-tv';
};
