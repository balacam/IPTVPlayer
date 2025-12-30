
import { createClient } from '@supabase/supabase-js';
import { isElectron } from '../utils/platform';

let supabase = null;

export const initSupabase = (url, key) => {
    if (!url || !key) throw new Error('Supabase URL and Key are required');
    supabase = createClient(url, key);
    return supabase;
};

export const getSupabaseClient = () => supabase;

export const fetchChannelsFromSupabase = async (url, key) => {
    try {
        // If Electron, use IPC to avoid browser restrictions on secret keys
        if (isElectron()) {
            console.log('Fetching from Supabase via Electron IPC...');
            const result = await window.electronAPI.invoke('supabase-fetch-channels', url, key);
            if (result.success) {
                return result.data || [];
            } else {
                throw new Error(result.error);
            }
        }

        // Web Fallback (will fail if using service key)
        const client = initSupabase(url, key);
        
        const { data, error } = await client
            .from('channels')
            .select('*')
            .order('id', { ascending: true });

        if (error) throw error;
        
        return data || [];
    } catch (error) {
        console.error('Supabase fetch error:', error);
        throw error;
    }
};
