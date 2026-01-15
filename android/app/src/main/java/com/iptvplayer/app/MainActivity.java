package com.iptvplayer.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VlcLauncherPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
