package com.iptvplayer.app;

import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.C;
import androidx.media3.common.util.Util;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.LoadControl;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;
import androidx.media3.ui.PlayerView;

public class PlayerActivity extends AppCompatActivity {
    private static final String TAG = "PlayerActivity";
    
    private PlayerView playerView;
    private ExoPlayer player;
    private String streamUrl;
    private String userAgent;
    private Handler reconnectHandler;
    private int reconnectAttempts = 0;
    private static final int MAX_RECONNECT_ATTEMPTS = 10;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        try {
            // Fullscreen
            getWindow().setFlags(
                WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN
            );
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            
            // Hide system UI
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
            
            setContentView(R.layout.activity_player);
            
            playerView = findViewById(R.id.player_view);
            playerView.setControllerShowTimeoutMs(1500); // 1.5 saniye sonra gizle
            playerView.setControllerHideOnTouch(true);
            playerView.setControllerAutoShow(false); // Otomatik gösterme
            
            reconnectHandler = new Handler(Looper.getMainLooper());
            
            // Get URL from intent
            streamUrl = getIntent().getStringExtra("url");
            userAgent = getIntent().getStringExtra("userAgent");
            
            if (streamUrl == null || streamUrl.isEmpty()) {
                Toast.makeText(this, "URL bulunamadı", Toast.LENGTH_SHORT).show();
                finish();
                return;
            }
            
            Log.i(TAG, "Starting player with URL: " + streamUrl);
            initializePlayer();
            
        } catch (Exception e) {
            Log.e(TAG, "onCreate error: " + e.getMessage(), e);
            Toast.makeText(this, "Player başlatılamadı: " + e.getMessage(), Toast.LENGTH_LONG).show();
            finish();
        }
    }
    
    @androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
    private void initializePlayer() {
        try {
            // Optimized buffering to prevent OOM
            LoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                    15000,      // Min buffer: 15 seconds
                    50000,      // Max buffer: 50 seconds
                    2500,       // Playback start: 2.5 seconds
                    5000        // Rebuffer: 5 seconds
                )
                .setBackBuffer(10000, true)  // 10 sn geri buffer
                .setTargetBufferBytes(C.LENGTH_UNSET)
                .setPrioritizeTimeOverSizeThresholds(true)
                .build();
            
            player = new ExoPlayer.Builder(this)
                .setLoadControl(loadControl)
                .build();
            
            playerView.setPlayer(player);
            playerView.setKeepScreenOn(true);
            
            // Error listener
            player.addListener(new Player.Listener() {
                @Override
                public void onPlayerError(PlaybackException error) {
                    Log.e(TAG, "Player error: " + error.getMessage());
                    handleError();
                }
                
                private long lastBufferingTime = 0;
                private int bufferingCount = 0;
                
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY) {
                        reconnectAttempts = 0;
                        bufferingCount = 0;
                        Log.i(TAG, "Playback ready, buffer: " + (player.getBufferedPosition() - player.getCurrentPosition()) + "ms");
                    } else if (state == Player.STATE_BUFFERING) {
                        Log.d(TAG, "Buffering at position: " + player.getCurrentPosition());
                        long now = System.currentTimeMillis();
                        // 20 saniye içinde 2+ buffering olursa yeniden bağlan
                        if (now - lastBufferingTime < 20000) {
                            bufferingCount++;
                            if (bufferingCount >= 2) {
                                Log.i(TAG, "Too many buffers, reconnecting stream");
                                bufferingCount = 0;
                                reconnectHandler.postDelayed(() -> {
                                    if (player != null) {
                                        player.stop();
                                        player.clearMediaItems();
                                        playStream();
                                    }
                                }, 1000);
                            }
                        } else {
                            bufferingCount = 1;
                        }
                        lastBufferingTime = now;
                    } else if (state == Player.STATE_ENDED) {
                        Log.i(TAG, "Stream ended, reconnecting...");
                        handleError();
                    }
                }
            });
            
            playStream();
            
        } catch (Exception e) {
            Log.e(TAG, "initializePlayer error: " + e.getMessage(), e);
            Toast.makeText(this, "Player hatası: " + e.getMessage(), Toast.LENGTH_LONG).show();
            finish();
        }
    }
    
    @androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
    private void playStream() {
        if (player == null || streamUrl == null) return;
        
        try {
            // Trim URL to avoid whitespace issues
            streamUrl = streamUrl.trim();
            
            // Xtream Codes fix removed - keeping original URL
            Uri uri = Uri.parse(streamUrl);
            
            // Generate default headers map
            java.util.Map<String, String> defaultHeaders = new java.util.HashMap<>();
            defaultHeaders.put("Connection", "keep-alive");
            
            // IMPORTANT: Inject cookies from WebView (Auth token usually lives here)
            String cookies = android.webkit.CookieManager.getInstance().getCookie(streamUrl);
            if (cookies != null && !cookies.isEmpty()) {
                Log.d(TAG, "Injecting authentication cookies into player");
                defaultHeaders.put("Cookie", cookies);
            }

            // Use the same User-Agent as the system WebView for consistency
            String defaultUserAgent = Util.getUserAgent(this, "IPTVPlayer");
            String finalUserAgent = userAgent != null && !userAgent.isEmpty() ? userAgent : defaultUserAgent;

            DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(finalUserAgent)
                .setConnectTimeoutMs(30000)
                .setReadTimeoutMs(30000)
                .setAllowCrossProtocolRedirects(true)
                .setKeepPostFor302Redirects(true)
                .setDefaultRequestProperties(defaultHeaders);
            
            DataSource.Factory dataSourceFactory = httpFactory;
            
            // Treat as live stream - daha toleranslı
            MediaItem mediaItem = new MediaItem.Builder()
                .setUri(uri)
                .setLiveConfiguration(
                    new MediaItem.LiveConfiguration.Builder()
                        .setMaxPlaybackSpeed(1.02f)
                        .setMinPlaybackSpeed(0.98f)
                        .setTargetOffsetMs(15000)
                        .setMinOffsetMs(10000)
                        .setMaxOffsetMs(60000)
                        .build()
                )
                .build();
            
            MediaSource mediaSource;
            
            // HLS veya Progressive source seç
            if (streamUrl.contains(".m3u8") || streamUrl.contains("m3u8")) {
                mediaSource = new HlsMediaSource.Factory(dataSourceFactory)
                    .setAllowChunklessPreparation(true)
                    .createMediaSource(mediaItem);
            } else {
                mediaSource = new ProgressiveMediaSource.Factory(dataSourceFactory)
                    .createMediaSource(mediaItem);
            }
            
            player.setMediaSource(mediaSource);
            player.prepare();
            player.setPlayWhenReady(true);
            
            Log.i(TAG, "Playing: " + streamUrl);
            
        } catch (Exception e) {
            Log.e(TAG, "playStream error: " + e.getMessage(), e);
            handleError();
        }
    }
    
    private void handleError() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            Toast.makeText(this, "Bağlantı kurulamadı", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        
        reconnectAttempts++;
        int delay = Math.min(reconnectAttempts * 2000, 10000);
        
        Log.i(TAG, "Reconnecting in " + delay + "ms (attempt " + reconnectAttempts + ")");
        
        reconnectHandler.postDelayed(() -> {
            if (player != null) {
                player.stop();
                player.clearMediaItems();
                playStream();
            }
        }, delay);
    }
    
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
                finish();
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
                if (player != null) {
                    player.setPlayWhenReady(!player.getPlayWhenReady());
                }
                return true;
        }
        return super.onKeyDown(keyCode, event);
    }
    
    @Override
    protected void onPause() {
        super.onPause();
        if (player != null) {
            player.setPlayWhenReady(false);
        }
    }
    
    @Override
    protected void onResume() {
        super.onResume();
        if (player != null) {
            player.setPlayWhenReady(true);
        }
    }
    
    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (reconnectHandler != null) {
            reconnectHandler.removeCallbacksAndMessages(null);
        }
        if (player != null) {
            player.release();
            player = null;
        }
    }
}
