import { app, BrowserWindow } from 'electron';

function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 750,
        webPreferences: {
            nodeIntegration: true,
        },
        show: false,
    });
    console.log(__dirname);
    win.loadFile('./app/index.html');
    win.once('ready-to-show', () => {
        win.show();
    });
}

app.on('ready', createWindow);
