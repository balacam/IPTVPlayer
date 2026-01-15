import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Load env vars
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const newVersion = process.argv[2];

if (!newVersion) {
    console.error('Please provide a version number (e.g., 2.0.0)');
    process.exit(1);
}

console.log(`Updating version to ${newVersion}...`);

// 1. Update package.json
const packageJsonPath = path.join(rootDir, 'package.json');
try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    packageJson.version = newVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 4));
    console.log('✅ Updated package.json');
} catch (e) {
    console.error('❌ Error updating package.json:', e.message);
}

// 2. Update .env
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, 'utf8');
    if (envContent.includes('VITE_APP_VERSION=')) {
        envContent = envContent.replace(/VITE_APP_VERSION=".*"/, `VITE_APP_VERSION="${newVersion}"`);
        fs.writeFileSync(envPath, envContent);
        console.log('✅ Updated .env');
    } else {
        console.warn('⚠️ VITE_APP_VERSION not found in .env');
    }
}

// 3. Update .env.tv
const envTvPath = path.join(rootDir, '.env.tv');
if (fs.existsSync(envTvPath)) {
    let envTvContent = fs.readFileSync(envTvPath, 'utf8');
    if (envTvContent.includes('VITE_APP_VERSION=')) {
        envTvContent = envTvContent.replace(/VITE_APP_VERSION=".*"/, `VITE_APP_VERSION="${newVersion}"`);
        fs.writeFileSync(envTvPath, envTvContent);
        console.log('✅ Updated .env.tv');
    } else {
        console.warn('⚠️ VITE_APP_VERSION not found in .env.tv');
    }
}

// 4. Update android/app/build.gradle
const gradlePath = path.join(rootDir, 'android', 'app', 'build.gradle');
if (fs.existsSync(gradlePath)) {
    let gradleContent = fs.readFileSync(gradlePath, 'utf8');

    // Update versionName
    gradleContent = gradleContent.replace(/versionName ".*"/, `versionName "${newVersion}"`);

    // Increment versionCode
    const versionCodeMatch = gradleContent.match(/versionCode (\d+)/);
    if (versionCodeMatch) {
        const currentCode = parseInt(versionCodeMatch[1]);
        const newCode = currentCode + 1;
        gradleContent = gradleContent.replace(/versionCode \d+/, `versionCode ${newCode}`);
        console.log(`✅ Updated build.gradle (versionName: ${newVersion}, versionCode: ${newCode})`);
    } else {
        console.warn('⚠️ Could not find versionCode in build.gradle');
    }

    fs.writeFileSync(gradlePath, gradleContent);
} else {
    console.warn('⚠️ android/app/build.gradle not found');
}

// 5. Update Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_KEY;

if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // We can't await at top level without wrapper in some older node versions or configs, 
    // but with type:module it should be fine. For safety, IIFE.
    (async () => {
        try {
            console.log('Connecting to Supabase...');
            const { data, error } = await supabase
                .from('app_config')
                .update({ value: newVersion })
                .eq('key', 'android_tv_version')
                .select();
                
            if (error) {
                console.error('❌ Error updating Supabase:', error);
            } else if (data && data.length > 0) {
                console.log('✅ Updated Supabase app_config:', data);
            } else {
                console.log('⚠️ No rows updated in Supabase (check if key exists)');
            }
        } catch (e) {
            console.error('❌ Exception updating Supabase:', e);
        }
    })();
} else {
    console.warn('⚠️ Supabase credentials not found in .env, skipping database update.');
}
