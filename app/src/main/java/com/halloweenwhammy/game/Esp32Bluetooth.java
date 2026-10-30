package com.halloweenwhammy.game;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.ArrayAdapter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.UUID;
import org.json.JSONObject;

/** Native BLE transport for the packaged game. All BLE state is owned by the UI thread. */
@SuppressLint("MissingPermission") // Permissions are checked before discovery; revocation is caught.
public final class Esp32Bluetooth {
    private static final int PERMISSIONS_REQUEST = 42;
    private static final UUID SERVICE = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID RX = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID TX = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private final Activity activity;
    private final WebView webView;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ArrayList<BluetoothDevice> devices = new ArrayList<>();
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private AlertDialog picker;
    private ArrayAdapter<String> deviceLabels;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic rx;
    private boolean ready;
    private boolean busy;
    private boolean foreground;
    private boolean destroyed;
    private boolean permissionPending;
    private boolean connectOnResume;
    private boolean writing;
    private int pendingReplies;
    private String status = "Disconnected";
    private final Runnable scanTimeout = this::finishScan;
    private final Runnable connectionTimeout = () -> close("Connection timed out. Try again.");
    private final Runnable writeTimeout = () -> close("Send timed out. Reconnect ESP32.");

    Esp32Bluetooth(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    @JavascriptInterface
    public void connect() {
        handler.post(() -> {
            if (destroyed || !foreground || busy || ready) return;
            if (!hasPermissions()) {
                permissionPending = true;
                update("Allow Bluetooth access to connect.", false, true);
                activity.requestPermissions(requiredPermissions(), PERMISSIONS_REQUEST);
            } else startScan();
        });
    }

    @JavascriptInterface
    public void disconnect() {
        handler.post(() -> close("Disconnected"));
    }

    @JavascriptInterface
    public void sendReady() {
        handler.post(() -> {
            if (!destroyed && ready && gatt != null) {
                pendingReplies++;
                writeNext();
            }
        });
    }

    @JavascriptInterface
    public void sync() {
        handler.post(() -> update(status, ready, busy));
    }

    void setForeground(boolean value) {
        foreground = value;
        if (value && connectOnResume) {
            connectOnResume = false;
            startScan();
        }
    }

    void onPermissionsResult(int requestCode) {
        if (requestCode != PERMISSIONS_REQUEST || !permissionPending || destroyed) return;
        permissionPending = false;
        if (hasPermissions()) {
            if (foreground) startScan();
            else connectOnResume = true;
        } else update("Bluetooth permission denied. Tap Connect to retry.", false, false);
    }

    private String[] requiredPermissions() {
        return Build.VERSION.SDK_INT >= 31
            ? new String[]{Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT}
            : new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION};
    }

    private boolean hasPermissions() {
        for (String permission : requiredPermissions()) {
            if (activity.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) return false;
        }
        return true;
    }

    private void update(String message, boolean connected, boolean working) {
        status = message;
        ready = connected;
        busy = working;
        if (!destroyed) webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('esp32-native-status',{detail:{message:"
                + JSONObject.quote(message) + ",connected:" + connected + ",busy:" + working + "}}))", null);
    }

    private void startScan() {
        try {
            BluetoothManager manager = activity.getSystemService(BluetoothManager.class);
            BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
            if (adapter == null) {
                update("This device does not support Bluetooth LE.", false, false);
                return;
            }
            if (!adapter.isEnabled()) {
                update("Turn on Bluetooth, then tap Connect ESP32.", false, false);
                return;
            }
            if (Build.VERSION.SDK_INT < 31) {
                LocationManager location = activity.getSystemService(LocationManager.class);
                boolean locationEnabled = location != null && (
                    location.isProviderEnabled(LocationManager.GPS_PROVIDER)
                        || location.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
                if (!locationEnabled) {
                    update("Enable Location for Bluetooth discovery on this Android version.", false, false);
                    return;
                }
            }
            scanner = adapter.getBluetoothLeScanner();
            if (scanner == null) {
                update("Bluetooth scanner unavailable. Try again.", false, false);
                return;
            }
            devices.clear();
            deviceLabels = new ArrayAdapter<>(activity, android.R.layout.simple_list_item_1);
            picker = new AlertDialog.Builder(activity)
                .setTitle("Select ESP32 — scanning…")
                .setAdapter(deviceLabels, (dialog, index) -> {
                    BluetoothDevice device = devices.get(index);
                    dismissPicker();
                    connectDevice(device);
                })
                .setNegativeButton("Cancel", (dialog, which) -> close("Disconnected"))
                .setOnCancelListener(dialog -> close("Disconnected"))
                .create();
            picker.show();
            update("Searching for ESP32…", false, true);
            scanCallback = createScanCallback();
            scanner.startScan(Collections.singletonList(
                new ScanFilter.Builder().setServiceUuid(new ParcelUuid(SERVICE)).build()),
                new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback);
            handler.postDelayed(scanTimeout, 12000);
        } catch (SecurityException | IllegalStateException error) {
            close("Cannot scan. Check Bluetooth permissions and try again.");
        }
    }

    private ScanCallback createScanCallback() {
        return new ScanCallback() {
            @Override
            public void onScanResult(int type, ScanResult result) {
                handler.post(() -> {
                    if (scanCallback != this || scanner == null || picker == null) return;
                    BluetoothDevice device = result.getDevice();
                    if (devices.contains(device)) return;
                    try {
                        String name = result.getScanRecord() == null ? null : result.getScanRecord().getDeviceName();
                        deviceLabels.add((name == null ? "Whammy ESP32" : name) + "\n" + device.getAddress());
                        devices.add(device);
                    } catch (SecurityException error) { close("Bluetooth permission lost."); }
                });
            }

            @Override
            public void onScanFailed(int errorCode) {
                handler.post(() -> {
                    if (scanCallback == this) close("Bluetooth scan failed. Try again.");
                });
            }
        };
    }

    private void stopScan() {
        handler.removeCallbacks(scanTimeout);
        if (scanner != null) {
            BluetoothLeScanner previousScanner = scanner;
            ScanCallback previousCallback = scanCallback;
            scanner = null;
            scanCallback = null;
            try { previousScanner.stopScan(previousCallback); } catch (SecurityException | IllegalStateException ignored) { }
        }
    }

    private void finishScan() {
        stopScan();
        if (picker != null) picker.setTitle(devices.isEmpty()
            ? "No ESP32 found — check power and try again" : "Select ESP32");
    }

    private void dismissPicker() {
        stopScan();
        if (picker != null) {
            picker.dismiss();
            picker = null;
        }
    }

    private void connectDevice(BluetoothDevice device) {
        update("Connecting to ESP32…", false, true);
        try {
            gatt = device.connectGatt(activity, false, gattCallback,
                BluetoothDevice.TRANSPORT_LE, BluetoothDevice.PHY_LE_1M_MASK, handler);
            if (gatt == null) close("Cannot connect. Try again.");
            else handler.postDelayed(connectionTimeout, 15000);
        } catch (SecurityException error) {
            close("Bluetooth permission denied. Tap Connect to retry.");
        }
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt current, int code, int state) {
            if (current != gatt) return;
            if (code != BluetoothGatt.GATT_SUCCESS || state == BluetoothProfile.STATE_DISCONNECTED) {
                close("Connection lost. Reconnect ESP32.");
            } else if (state == BluetoothProfile.STATE_CONNECTED) {
                try {
                    if (!current.discoverServices()) close("Cannot discover ESP32 service. Try again.");
                } catch (SecurityException error) { close("Bluetooth permission lost."); }
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt current, int code) {
            if (current != gatt) return;
            if (code != BluetoothGatt.GATT_SUCCESS) {
                close("Cannot discover ESP32 service. Try again.");
                return;
            }
            BluetoothGattService service = current.getService(SERVICE);
            rx = service == null ? null : service.getCharacteristic(RX);
            BluetoothGattCharacteristic tx = service == null ? null : service.getCharacteristic(TX);
            BluetoothGattDescriptor cccd = tx == null ? null : tx.getDescriptor(CCCD);
            if (rx == null || tx == null || cccd == null
                || (rx.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE) == 0
                || (tx.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) == 0) {
                close("ESP32 service mismatch. Check the firmware protocol.");
                return;
            }
            try {
                if (!current.setCharacteristicNotification(tx, true)) {
                    close("Cannot enable ESP32 notifications.");
                    return;
                }
                boolean started;
                if (Build.VERSION.SDK_INT >= 33) {
                    started = current.writeDescriptor(cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                        == BluetoothStatusCodes.SUCCESS;
                } else {
                    cccd.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    started = current.writeDescriptor(cccd);
                }
                if (!started) close("Cannot subscribe to ESP32 buttons.");
            } catch (SecurityException error) { close("Bluetooth permission lost."); }
        }

        @Override
        public void onDescriptorWrite(BluetoothGatt current, BluetoothGattDescriptor descriptor, int code) {
            if (current != gatt || !CCCD.equals(descriptor.getUuid())) return;
            if (code != BluetoothGatt.GATT_SUCCESS) {
                close("Cannot subscribe to ESP32 buttons.");
                return;
            }
            handler.removeCallbacks(connectionTimeout);
            update("Connected", true, false);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt current, BluetoothGattCharacteristic characteristic,
                                             byte[] value) {
            receive(current, characteristic, value);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt current, BluetoothGattCharacteristic characteristic) {
            if (Build.VERSION.SDK_INT < 33) receive(current, characteristic, characteristic.getValue());
        }

        @Override
        public void onCharacteristicWrite(BluetoothGatt current, BluetoothGattCharacteristic characteristic, int code) {
            if (current != gatt || !RX.equals(characteristic.getUuid()) || !writing) return;
            handler.removeCallbacks(writeTimeout);
            if (code != BluetoothGatt.GATT_SUCCESS) {
                close("Send failed. Reconnect ESP32.");
                return;
            }
            writing = false;
            pendingReplies--;
            writeNext();
        }
    };

    private void receive(BluetoothGatt current, BluetoothGattCharacteristic characteristic, byte[] bytes) {
        if (current != gatt || !ready || !foreground || !TX.equals(characteristic.getUuid()) || bytes == null) return;
        for (byte value : bytes) {
            char command = Character.toUpperCase((char) (value & 0xff));
            if (command == 'P' || command == 'S') webView.evaluateJavascript(
                "document.dispatchEvent(new CustomEvent('whammy-command',{detail:'" + command + "'}))", null);
        }
    }

    private void writeNext() {
        if (!ready || gatt == null || writing || pendingReplies == 0) return;
        try {
            writing = true;
            boolean started;
            if (Build.VERSION.SDK_INT >= 33) {
                started = gatt.writeCharacteristic(rx, new byte[]{'R'}, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)
                    == BluetoothStatusCodes.SUCCESS;
            } else {
                rx.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
                rx.setValue(new byte[]{'R'});
                started = gatt.writeCharacteristic(rx);
            }
            if (started) handler.postDelayed(writeTimeout, 5000);
            else close("Send failed. Reconnect ESP32.");
        } catch (SecurityException error) { close("Bluetooth permission lost."); }
    }

    private void close(String message) {
        permissionPending = false;
        connectOnResume = false;
        dismissPicker();
        handler.removeCallbacks(connectionTimeout);
        handler.removeCallbacks(writeTimeout);
        BluetoothGatt previous = gatt;
        gatt = null;
        rx = null;
        writing = false;
        pendingReplies = 0;
        if (previous != null) {
            try { previous.disconnect(); } catch (SecurityException ignored) { }
            try { previous.close(); } catch (SecurityException ignored) { }
        }
        update(message, false, false);
    }

    void destroy() {
        destroyed = true;
        close("Disconnected");
        handler.removeCallbacksAndMessages(null);
    }
}
