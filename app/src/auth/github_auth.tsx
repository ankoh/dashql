import * as React from "react";

/// Refs:
/// https://docs.github.com/en/free-pro-team@latest/developers/apps/authorizing-oauth-apps
/// https://developer.github.com/apps/building-oauth-apps/understanding-scopes-for-oauth-apps/#available-scopes

const OAUTH_CLIENT_ID="907ea9e28eb25498492d"
const OAUTH_REDIRECT_URI="http://localhost:9000/auth/github/callback";
const OAUTH_SCOPES="gist read:user read:email";
const OAUTH_POPUP_NAME="DashQL <3 GitHub";
const OAUTH_POPUP_SETTINGS = 'toolbar=no, menubar=no, width=600, height=700, top=100, left=100';
//const OAUTH_PROXY="https://some-oauth-proxy.dashql.com";

/// Generate oauth state
let OAUTH_STATE: string | null = null;
function getOAuthState() {
    if (OAUTH_STATE != null)
        return OAUTH_STATE;
    OAUTH_STATE = "";
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const charactersLength = characters.length;
    for ( var i = 0; i < 20; i++ ) {
        OAUTH_STATE += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return OAUTH_STATE;
}

/// Callback component that is used within the popup to pass the parameters back to us
export const GitHubOAuthCallback: React.FC<{}> = () => {
    const params = window.location.search;
    if (window.opener) {
        window.opener.postMessage(params);
        window.close();
    }
    return <p>Please wait...</p>;
};

/// Callback to receive a message from the popup window
let popup: any | null = null;
let popupURL: any | null = null;
function receiveMessage(event: any) {
    console.log(event);
    popup = null;
    popupURL = null;
};

/// Authorize the user
export async function auth() {
    const redirect_uri = encodeURIComponent(OAUTH_REDIRECT_URI);
    const state = getOAuthState();
    const scopes = encodeURIComponent(OAUTH_SCOPES);
    const params = [
        `client_id=${OAUTH_CLIENT_ID}`,
        `redirect_uri=${redirect_uri}`,
        `scope=${scopes}`,
        `state=${state}`
    ].join("&");
    const url = `https://github.com/login/oauth/authorize?${params}`;

    // Readd the event listener
    window.removeEventListener('message', receiveMessage);
    window.addEventListener('message', event => receiveMessage(event), false);

    // New popup?
    if (popup === null || popup.closed) {
        popup = window.open(url, OAUTH_POPUP_NAME, OAUTH_POPUP_SETTINGS);
    } else if (popupURL !== url) {
        // Popup exists but has different URL
        popup = window.open(url, OAUTH_POPUP_NAME, OAUTH_POPUP_SETTINGS);
        popup.focus();
    } else {
        // Popup exists and has the correct URL
        popup.focus();
    }
    popupURL = url;
}
