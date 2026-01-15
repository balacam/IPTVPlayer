/**
 * Auto Update Service for Android TV
 * Checks for new versions and downloads APK updates
 */

import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';

const CURRENT_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';
const APK_BASE_URL = import.meta.env.VITE_APK_BASE_URL || '';

// Generate APK URL from version: 1.0.0 -> IPTVPlayer-TV-1.0.0.apk
const getApkUrl = (version) => {
    if (!APK_BASE_URL) return '';
    // Use full version string to match file name (e.g. IPTVPlayer-TV-2.0.0.apk)
    return `${APK_BASE_URL}/IPTVPlayer-TV-${version}.apk`;
};

// Compare semantic versions: returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
const compareVersions = (v1, v2) => {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
};

/**
 * Check for updates from Supabase
 * Expects a table called 'app_config' with columns: key, value
 * Required rows:
 *   - key: 'android_tv_version', value: '1.1.0' (latest version)
 *   - key: 'android_tv_changelog', value: 'Bug fixes...' (optional)
 * APK URL is auto-generated: {APK_BASE_URL}/IPTVPlayer-{version}.apk
 */
export const checkForUpdate = async (supabaseUrl, supabaseKey) => {
    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/app_config?select=key,value`, {
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch update info');
        }

        const configs = await response.json();
        const configMap = {};
        configs.forEach(c => configMap[c.key] = c.value);

        const latestVersion = configMap['android_tv_version'];
        const changelog = configMap['android_tv_changelog'] || '';

        if (!latestVersion) {
            console.log('No version info found in database');
            return { hasUpdate: false };
        }

        // Generate APK URL dynamically from version
        const apkUrl = getApkUrl(latestVersion);
        const hasUpdate = compareVersions(latestVersion, CURRENT_VERSION) > 0;

        return {
            hasUpdate,
            currentVersion: CURRENT_VERSION,
            latestVersion,
            apkUrl,
            changelog
        };
    } catch (error) {
        console.error('Update check failed:', error);
        return { hasUpdate: false, error: error.message };
    }
};

/**
 * Download and install APK update (Android only)
 */
export const downloadAndInstallUpdate = async (apkUrl, onProgress) => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
        throw new Error('APK install only available on Android');
    }

    try {
        // Dosya adını URL'den al
        const fileName = apkUrl.split('/').pop() || 'update.apk';
        
        // 1. Dosyayı indir (Fetch kullanarak)
        const response = await fetch(apkUrl);
        const blob = await response.blob();

        // Blob verisini Base64 formatına çevir (Filesystem için gerekli)
        const convertBlobToBase64 = (blob) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = reject;
            reader.onload = () => {
                resolve(reader.result);
            };
            reader.readAsDataURL(blob);
        });

        const base64Data = await convertBlobToBase64(blob);

        // 2. Dosyayı Cihazın Önbelleğine (Cache) Kaydet
        const savedFile = await Filesystem.writeFile({
            path: fileName,
            data: base64Data,
            directory: Directory.Cache, // Cache dizini genellikle izin sorunu çıkarmaz
            recursive: true
        });

        // 3. APK Dosyasını Yükleyici ile Aç
        await FileOpener.open({
            filePath: savedFile.uri,
            contentType: 'application/vnd.android.package-archive',
            openWithDefault: false
        });

        return { success: true, message: 'Yükleme ekranı açıldı' };

    } catch (error) {
        console.error('Download/Install failed:', error);
        throw error;
    }
};

export const getCurrentVersion = () => CURRENT_VERSION;
