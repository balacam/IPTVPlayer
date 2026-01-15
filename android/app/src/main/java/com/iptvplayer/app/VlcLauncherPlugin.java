package com.iptvplayer.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "VlcLauncher")
public class VlcLauncherPlugin extends Plugin {
    private static final String TAG = "VlcLauncherPlugin";
    
    @PluginMethod
    public void launchVideo(PluginCall call) {
        String url = call.getString("url");
        String userAgent = call.getString("userAgent");
        
        if (url == null) {
            call.reject("URL zorunludur");
            return;
        }
        
        Log.i(TAG, "Launching player with URL: " + url);
        
        getActivity().runOnUiThread(() -> {
            // Önce kendi player'ımızı dene
            try {
                Intent intent = new Intent(getContext(), PlayerActivity.class);
                intent.putExtra("url", url);
                intent.putExtra("userAgent", userAgent);
                getActivity().startActivity(intent);
                call.resolve();
                return;
            } catch (Exception e) {
                Log.e(TAG, "Built-in player failed: " + e.getMessage());
            }
            
            // Fallback: Just Player
            try {
                Uri uri = Uri.parse(url);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setPackage("com.brouken.player");
                intent.setDataAndType(uri, "video/*");
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                if (userAgent != null) {
                    intent.putExtra("http-header-user-agent", userAgent);
                }
                getActivity().startActivity(intent);
                call.resolve();
                return;
            } catch (ActivityNotFoundException e) {
                Log.d(TAG, "Just Player not found");
            }
            
            // Fallback: VLC
            try {
                Uri uri = Uri.parse(url);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setPackage("org.videolan.vlc");
                intent.setDataAndType(uri, "video/*");
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(intent);
                call.resolve();
                return;
            } catch (ActivityNotFoundException e) {
                Log.d(TAG, "VLC not found");
            }
            
            call.reject("No player available");
        });
    }
}
