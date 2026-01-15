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
            // Agresif buffering - büyük buffer, sürekli yükle
            LoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                    60000,      // Min buffer: 60 saniye (büyük tut)
                    120000,     // Max buffer: 2 dakika
                    2000,       // Playback start: 2 saniye
                    5000        // Rebuffer: 5 saniye
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
            // HTTP data source with custom user agent and keep-alive
            DefaultHttpDataSource.Factory httpFactory = new DefaultHttpDataSource.Factory()
                .setUserAgent(userAgent != null ? userAgent : "ExoPlayer")
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(15000)
                .setAllowCrossProtocolRedirects(true)
                .setKeepPostFor302Redirects(true);
            
            DataSource.Factory dataSourceFactory = httpFactory;
            
            MediaSource mediaSource;
            Uri uri = Uri.parse(streamUrl);
            
            // Treat as live stream - daha toleranslı
            MediaItem mediaItem = new MediaItem.Builder()
                .setUri(uri)
                .setLiveConfiguration(
                    new MediaItem.LiveConfiguration.Builder()
                        .setMaxPlaybackSpeed(1.02f)  // Yavaş catch up
                        .setMinPlaybackSpeed(0.98f)  // Yavaş slow down
                        .setTargetOffsetMs(15000)    // 15 saniye live edge'den uzak
                        .setMinOffsetMs(10000)
                        .setMaxOffsetMs(60000)
                        .build()
                )
                .build();
            
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
