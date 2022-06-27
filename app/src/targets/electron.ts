import { app, BrowserWindow } from 'electron';
import url from 'url';
import path from 'path';

function createWindow() {
    const win = new BrowserWindow({
        width: 1400,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
        },
    });
    win.webContents.openDevTools();
    //win.loadURL(`file://index.html`);
    //    win.loadURL(
    //        url.format({
    //            pathname: path.join(__dirname, 'index.html'),
    //            protocol: 'file',
    //            slashes: true,
    //        }),
    //    );
    win.loadFile('index.html');
}

app.on('ready', createWindow);
