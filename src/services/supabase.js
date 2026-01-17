import { createClient } from '@supabase/supabase-js';

let supabase = null;

export const initSupabase = (url, key) => {
    if (!url || !key) throw new Error('Supabase URL and Key are required');
    supabase = createClient(url, key);
    return supabase;
};

export const getSupabaseClient = () => supabase;

/**
 * Fetch channels using direct REST API
 */
export const fetchChannelsFromSupabase = async (url, key) => {
    if (!url || !key) {
        console.error('Supabase Configuration Missing!', { url, key: key ? 'PRESENT' : 'MISSING' });
        throw new Error('Supabase URL or Key is missing. Please check your .env file and rebuild the app.');
    }
    try {
        console.log('Fetching from Supabase via REST API...');
        
        const response = await fetch(`${url}/rest/v1/channels?select=*&order=id.asc`, {
            headers: {
                'apikey': key,
                'Authorization': `Bearer ${key}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Database error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data || [];
        
    } catch (error) {
        console.error('Supabase fetch error:', error);
        throw error;
    }
};
