import { app, BrowserWindow, MessageChannelMain } from 'electron';

function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 750,
        webPreferences: {
            nodeIntegration: true,
        },
        show: false,
        autoHideMenuBar: true,
    });
    win.loadFile('./app/index.html');
    win.once('ready-to-show', () => {
        win.show();
    });
    const { port1, port2 } = new MessageChannelMain();
    win.webContents.postMessage('ipc_backend_configure', null, [port2]);
}

app.on('ready', createWindow);
