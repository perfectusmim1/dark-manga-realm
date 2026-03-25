const DEVICE_INSTALLATION_KEY = 'toonparrot_device_installation_id';

const sha256Hex = async (value: string) => {
    const encoded = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
};

export const getOrCreateDeviceInstallationId = () => {
    if (typeof window === 'undefined') {
        return 'server-render';
    }

    const existing = window.localStorage.getItem(DEVICE_INSTALLATION_KEY);
    if (existing) {
        return existing;
    }

    const created = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_INSTALLATION_KEY, created);
    return created;
};

export const getDeviceIdentity = async () => {
    const installationId = getOrCreateDeviceInstallationId();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
    const screenInfo = typeof window !== 'undefined'
        ? `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`
        : 'server';

    const seed = [
        installationId,
        navigator.userAgent || 'unknown',
        navigator.language || 'unknown',
        navigator.platform || 'unknown',
        `${navigator.hardwareConcurrency || 0}`,
        `${navigator.maxTouchPoints || 0}`,
        timezone,
        screenInfo,
    ].join('|');

    return {
        deviceInstallationId: installationId,
        deviceHash: await sha256Hex(seed),
    };
};
