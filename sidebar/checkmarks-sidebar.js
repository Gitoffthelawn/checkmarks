/**
 * Class for the sidebar action.
 * @constructor
 */
function RemarksSidebar() {

    // Default options for convenient access.
    let TIMEOUT = RE_DEFAULTS.getTimeout() * 1000;
    let TIMEOUT_OVERRULE = RE_DEFAULTS.getTimeoutOverrule();
    let MAX_TABS = RE_DEFAULTS.getMaxTabs();
    let IGNORED_DIRS = RE_DEFAULTS.getIgnoredDirs();
    let IGNORED_URLS = RE_DEFAULTS.getIgnoredUrls();
    let SHOW_FAVICONS = RE_DEFAULTS.getShowFavicons();
    let TO_LOWERCASE = RE_DEFAULTS.getToLowercase();

    // Constants for error-mapping and tooltips.
    // Custom error definitions:
    const ERROR_DUPLICATE = 'duplicate';
    const ERROR_TIMEOUT = 'timeout';
    const ERROR_UNSPECIFIED = 'unspecified_40x/50x'; // Not yet...
    // Request errors:
    const ERROR_RESOURCE_NOT_FOUND = 'resource_not_found';
    const ERROR_AUTH_REQUIRED = 'authentication_required';
    // Navigation errors:
    const ERROR_SERVER_NOT_FOUND = 'server_not_found';
    const ERROR_CONNECTION_REFUSED = 'connection_refused';
    const ERROR_INVALID_CERTIFICATE = 'invalid_certificate';
    const ERROR_BINDING_ABORTED = 'redirect'; // Actually a warning. Loading will continue.
    const ERROR_ABORTED = 'aborted';
    const ERROR_INTERRUPT = 'connection_interrupted';

    // Error codes provided by the web-extensions API and some HTTP error codes.
    const ERROR_CODES_TO_TYPE = {
        '2152398878': ERROR_SERVER_NOT_FOUND,
        '2152398861': ERROR_CONNECTION_REFUSED,
        '2153394164': ERROR_INVALID_CERTIFICATE,
        '2152398850': ERROR_BINDING_ABORTED,
        '2147500036': ERROR_ABORTED,
        '2152398919': ERROR_INTERRUPT,
        '401': ERROR_AUTH_REQUIRED,
        '403': ERROR_AUTH_REQUIRED,
        '404': ERROR_RESOURCE_NOT_FOUND,
        '405': ERROR_AUTH_REQUIRED,
        '407': ERROR_AUTH_REQUIRED
    };

    // Maps known error constants to material-icon-ids.
    const ERROR_TYPE_TO_ICON = {};
    // Custom error definitions:
    ERROR_TYPE_TO_ICON[ERROR_DUPLICATE] = 'content_copy';
    ERROR_TYPE_TO_ICON[ERROR_TIMEOUT] = 'hourglass_full';
    ERROR_TYPE_TO_ICON[ERROR_UNSPECIFIED] = 'warning';
    // Request errors:
    ERROR_TYPE_TO_ICON[ERROR_RESOURCE_NOT_FOUND] = 'cloud_off';
    ERROR_TYPE_TO_ICON[ERROR_AUTH_REQUIRED] = 'security';
    // Navigation errors:
    ERROR_TYPE_TO_ICON[ERROR_SERVER_NOT_FOUND] = 'dns';
    ERROR_TYPE_TO_ICON[ERROR_CONNECTION_REFUSED] = 'block';
    ERROR_TYPE_TO_ICON[ERROR_INVALID_CERTIFICATE] = 'no_encryption';
    ERROR_TYPE_TO_ICON[ERROR_BINDING_ABORTED] = 'directions';
    ERROR_TYPE_TO_ICON[ERROR_ABORTED] = 'report';
    ERROR_TYPE_TO_ICON[ERROR_INTERRUPT] = 'report';

    // DOM objects.
    const START = document.getElementById('start');
    const CANCEL = document.getElementById('cancel');
    const OPTIONS = document.getElementById('options');
    const HELP = document.getElementById('help');
    const PROGRESS = document.getElementById('progress');
    const PROGRESS_BAR = document.getElementById('progress-bar');
    const STATS = document.getElementById('stats');
    const FAVICONS = document.getElementById('favicons');
    const MESSAGES = document.getElementById('messages');
    const MODAL = document.getElementById('modal');
    const MODAL_WARNING = document.getElementById('modal-warning');
    const MODAL_WARNING_CONFIRM = document.getElementById('modal-warning-confirm');
    const MODAL_WARNING_CANCEL = document.getElementById('modal-warning-cancel');
    const MODAL_HELP = document.getElementById('modal-help');
    const MODAL_HELP_CLOSE = document.getElementById('modal-help-close');

    const POST_LOAD_TIMEOUT = 2000;

    let bookmarks = [];
    let urls = {};
    let bookmarksIgnored = [];
    let bookmarksToProcess = 0;
    let bookmarksProcessed = 0;
    let errorCount = 0;
    let tabCount = 0;
    let tabRegistry = {}; // tabId => bookmark, tabIdcomplete => true/false
    let tabRequestMap = {}; // tabId => requestCount, tabUrl => error
    let timeoutIds = [];
    let hostWindowId = -1;
    let modalBookmarkId = -1;
    let removalConfirmed = false;

    /**
     * Registers the event-listeners for sidebar controls.
     */
    this.init = function () {
        // Start button that initializes the chain of events.
        START.addEventListener('click', () => {
            browser.storage.local.get()
                .then((options) => {

                    setOptions(options);
                    resetState();

                    browser.bookmarks.getTree()
                        .then(run);
                });
        });

        // Cancel button that interrupts the chain of events.
        CANCEL.addEventListener('click', () => {
            cancel();
        });

        // Link to Options page.
        OPTIONS.addEventListener('click', () => {
            browser.runtime.openOptionsPage();
        });

        // Open help modal.
        HELP.addEventListener('click', () => {
            MODAL.style.display = 'block';
            MODAL_HELP.style.display = 'block';
            MODAL_WARNING.style.display = 'none';
        });

        // Confirmation button for the removal of bookmarks.
        MODAL_WARNING_CONFIRM.addEventListener('click', () => {
            removeBookmark(modalBookmarkId, true);
            MODAL.style.display = 'none';
            removalConfirmed = true;
        });

        // Hides modals
        [MODAL_WARNING_CANCEL, MODAL_HELP_CLOSE].forEach((element) => {
            element.addEventListener('click', () => {
                MODAL.style.display = 'none';
            });
        });

        // Hides confirmation dialog for the removal of bookmarks when the user clicks somewhere else.
        window.addEventListener('click', (event) => {
            if (event.target === MODAL) {
                MODAL.style.display = 'none';
            }
        });
    };

    /**
     * Restores options from local storage or sets default values.
     * @param options {{}} Options map from local storage.
     */
    let setOptions = function (options) {
        TIMEOUT = typeof options.requestTimeout !== 'undefined' ? options.requestTimeout * 1000 : TIMEOUT;
        TIMEOUT_OVERRULE = typeof options.timeoutOverrule !== 'undefined' ? options.timeoutOverrule : TIMEOUT_OVERRULE;
        MAX_TABS = typeof options.maxTabs !== 'undefined' ? options.maxTabs : MAX_TABS;
        IGNORED_DIRS = typeof options.ignoredDirs !== 'undefined' ? getOptionsArray(options.ignoredDirs) : IGNORED_DIRS;
        IGNORED_URLS = typeof options.ignoredUrls !== 'undefined' ? getOptionsArray(options.ignoredUrls) : IGNORED_URLS;
        SHOW_FAVICONS = typeof options.showFavicons !== 'undefined' ? options.showFavicons : SHOW_FAVICONS;
        TO_LOWERCASE = typeof options.toLowercase !== 'undefined' ? options.toLowercase : TO_LOWERCASE;
    };

    /**
     * Resets some UI elements and almost all state members to their initial state.
     */
    let resetState = function () {
        PROGRESS_BAR.style.width = '0%';
        PROGRESS.innerHTML = '';
        MESSAGES.innerHTML = '';
        MESSAGES.style.marginTop = '100px';
        STATS.style.display = 'none';
        FAVICONS.style.display = 'none';
        FAVICONS.innerHTML = '';

        bookmarks = [];
        urls = {};
        bookmarksIgnored = [];
        bookmarksToProcess = 0;
        bookmarksProcessed = 0;
        errorCount = 0;
        tabCount = 0;
        tabRegistry = {};
        tabRequestMap = {};
        timeoutIds = [];
    };

    /**
     * Registers listeners that keep the chain of events going.
     */
    let registerListeners = function () {
        browser.tabs.onRemoved.addListener(onRemoved);
        browser.webNavigation.onCompleted.addListener(onNavigationCompleted);
        browser.webNavigation.onErrorOccurred.addListener(onNavigationError);
        browser.webRequest.onCompleted.addListener(
            onRequestCompleted,
            {urls: ['<all_urls>']}
        );
    };

    /**
     * Removes listeners again.
     */
    let removeListeners = function () {
        browser.tabs.onRemoved.removeListener(onRemoved);
        browser.webNavigation.onCompleted.removeListener(onNavigationCompleted);
        browser.webNavigation.onErrorOccurred.removeListener(onNavigationError);
        browser.webRequest.onCompleted.removeListener(onRequestCompleted);
    };

    /**
     * Cancels a running bookmarks-check. Events are blocked, listeners and timeouts removed, opened tabs closed
     * and state is reset.
     */
    let cancel = function () {
        removeListeners();
        timeoutIds.forEach((id) => {
            clearTimeout(id);
        });
        Object.keys(tabRegistry).forEach((id) => {
            if (!id.endsWith('complete')) {
                browser.tabs.remove(parseInt(id));
            }
        });
        resetState();
    };

    /**
     * Initializes the chain of events by collecting bookmark-information and loading the first batch of bookmarks.
     * The batch-size is dependent on the configured maximum number of tabs.
     * @param tree {browser.bookmarks.BookmarkTreeNode}
     */
    let run = function (tree) {
        walk(tree[0], '/');

        bookmarksToProcess = bookmarks.length;
        setStats();
        registerListeners();

        browser.windows.getCurrent()
            .then((window) => {
                // Only open tabs in the window the extension was started in.
                hostWindowId = window.id;

                while (tabCount < MAX_TABS && bookmarks.length > 0) {
                    loadBookmark();
                }
            }, (error) => {
                console.error(`ERROR: Could not get window id: ${error};`);
            });
    };

    /**
     * Recursively traverses bookmark-folders.
     * @param treeItem {browser.bookmarks.BookmarkTreeNode}
     * @param path {string} Path to the currently processed bookmark-folder.
     */
    let walk = function (treeItem, path) {
        if (treeItem.url && treeItem.url.startsWith('http')) {
            if (isIgnored(treeItem.url, IGNORED_URLS) || isIgnored(path, IGNORED_DIRS)) {
                // The bookmark or currently processed folder is ignored.
                // Maybe display information about ignored bookmarks? Stored!
                bookmarksIgnored.push(treeItem);
            } else {
                // Format
                if (TO_LOWERCASE) {
                    browser.bookmarks.update(treeItem.id, {title: treeItem.title.toLowerCase()});
                }
                if (treeItem.url in urls) {
                    // Bookmark is duplicated.
                    reportDuplicate(treeItem);
                } else {
                    // Store urls for duplicate-check.
                    urls[treeItem.url] = true;
                    bookmarks.push(treeItem);
                }
            }
        } else if (typeof treeItem.children !== 'undefined') {
            // In order to get statistics recurse into the folder even if it is ignored!
            treeItem.children.forEach((child) => {
                walk(child, path + treeItem.title + '/');
            });
        }
    };

    /**
     * Checks if a bookmark should be ignored. Its called for checking folder and url separately.
     * @param pathOrUrl Path to the bookmark or its url.
     * @param ignoreArray Array of ignored (partial) paths or urls.
     * @returns {boolean}
     */
    let isIgnored = function (pathOrUrl, ignoreArray) {
        return pathOrUrl !== '' && ignoreArray.some((x) => {
            return pathOrUrl.toLowerCase().includes(x.toLowerCase());
        });
    };

    /**
     * Creates a new tab and loads the next bookmark from the stack. It also sets the procedure which is called on
     * timeout.
     */
    let loadBookmark = function () {
        tabCount++;
        let bookmark = bookmarks.shift();
        browser.tabs.create({url: bookmark.url, windowId: hostWindowId, active: false})
            .then((tab) => {
                tabRegistry[tab.id] = bookmark;
                timeoutIds.push(setTimeout(() => {
                    onTimeout(tab);
                }, TIMEOUT));
            }, (error) => {
                tabCount--;
                console.error(`ERROR: Could not create tab: ${error};`);
            });
    };

    /**
     * Identifies several common HTTP errors and counts successful sub-requests while loading a bookmark.
     * @param details {{}} Details from {browser.webRequest.onCompleted}.
     */
    let onRequestCompleted = function (details) {
        if (details.tabId in tabRegistry || details.tabId === -1) {
            if (details.type === 'main_frame' && details.statusCode >= 400) {
                if (details.statusCode in ERROR_CODES_TO_TYPE) {
                    console.warn(`WARN: HTTP error: ${details.statusCode} tab: ${details.tabId} url: ${details.url}`);
                    handleRequestError(details, ERROR_CODES_TO_TYPE[details.statusCode]);
                } else {
                    // >= 500 or some other 40x
                    console.error(`ERROR: HTTP error: ${details.statusCode} tab: ${details.tabId} url: ${details.url}`);
                    handleRequestError(details, ERROR_UNSPECIFIED);
                }
            } else if (details.statusCode >= 200 && details.statusCode < 300) {
                // Count successful requests during load.
                if (details.tabId in tabRequestMap) {
                    tabRequestMap[details.tabId] += 1;
                } else {
                    tabRequestMap[details.tabId] = 1;
                }

            }
        }

    };

    /**
     * Checks if a bookmark is loaded completely or has produced errors and dispatches to success- and error-handlers.
     * @param details {{}} Details from {browser.webRequest.onCompleted}.
     */
    let onNavigationCompleted = function (details) {
        if (details.tabId in tabRegistry) {
            if (details.url in tabRequestMap) {
                // HTTP error detected in onRequestCompleted but tabId was -1.
                handleError(details.tabId, tabRequestMap[details.url]);
            } else {
                browser.tabs.get(details.tabId)
                    .then((tab) => {
                        const tabCompleteKey = tab.id + 'complete';
                        if (tab.status === 'complete' && !(tabCompleteKey in tabRegistry)) {
                            // Sometimes a tab reports "status complete" twice?
                            tabRegistry[tabCompleteKey] = true;
                            handleSuccess(tab);
                        }
                    });
            }
        }
    };

    /**
     * Identifies several known navigation errors.
     * @param details {{}} Details from {browser.webRequest.onNavigationError}.
     */
    let onNavigationError = function (details) {
        if (details.tabId in tabRegistry) {
            const errorCode = details.error.replace('Error code ', '');

            if (errorCode in ERROR_CODES_TO_TYPE) {
                let errorType = ERROR_CODES_TO_TYPE[errorCode];
                // Capitalize and remove underline characters!
                let errorString = (errorType.charAt(0).toUpperCase() + errorType.slice(1)).replace(/_/g, ' ');
                let bookmark = tabRegistry[details.tabId];

                if (details.frameId === 0) {
                    // Main frame...
                    handleError(details.tabId, errorType);
                    console.warn(`WARN: ${errorString}; bookmark: ${bookmark.title}; request: ${details.url};`);
                } else {
                    console.info(`INFO: ${errorString}; bookmark: ${bookmark.title}; request: ${details.url};`);
                }
            } else {
                // Unknown
                console.error(`ERROR: Unknown navigation error: ${JSON.stringify(details)};`);
            }
        }
    };

    /**
     * After a tab is removed, ie the bookmark was loaded successfully or not, statistics and state are updated.
     * @param tabId Id of the removed tab.
     */
    let onRemoved = function (tabId) {
        if (tabId in tabRegistry) {
            delete tabRegistry[tabId];

            bookmarksProcessed++;
            tabCount--;

            let percent = Math.round(bookmarksProcessed / bookmarksToProcess * 100) + '%';
            PROGRESS_BAR.style.width = percent;
            PROGRESS.innerHTML = percent;

            if (bookmarksProcessed === bookmarksToProcess) {
                removeListeners();
                if (SHOW_FAVICONS) {
                    FAVICONS.style.display = 'none';
                    MESSAGES.style.marginTop = '100px';
                }
            } else if (bookmarks.length > 0) {
                loadBookmark();
            }
        }
    };

    /**
     * Removes a tab on timeout and decides if the bookmark is considered to be broken, based on successful requests.
     * @param tab {tabs.Tab} that timed out.
     */
    let onTimeout = function (tab) {
        const tabCompleteKey = tab.id + 'complete';
        if (tab.id in tabRegistry && !(tabCompleteKey in tabRegistry)) {
            if (!(tab.id in tabRequestMap && tabRequestMap[tab.id] > TIMEOUT_OVERRULE)) {
                handleError(tab.id, ERROR_TIMEOUT);
            } else {
                tabRegistry[tabCompleteKey] = false;
                let bookmark = tabRegistry[tab.id];
                let responses = tabRequestMap[tab.id];
                console.info(`INFO: Timeout overruled; ${responses} successful requests; bookmark: ${bookmark.url};`);
                handleSuccess(tab);
            }
        }
    };

    /**
     * Removes the successfully loaded tab and displays its favicon - if present.
     * @param tab {tabs.Tab} Successfully loaded tab.
     */
    let handleSuccess = function (tab) {
        if (SHOW_FAVICONS && typeof tab.favIconUrl !== 'undefined') {
            setFavicon(tab.favIconUrl);
        }
        timeoutIds.push(setTimeout(() => {
            browser.tabs.remove(tab.id);
        }, POST_LOAD_TIMEOUT));
    };

    /**
     * Initializes the chain of events that is followed by errors while loading a bookmark. This includes reporting and
     * removing the tab. On redirection "errors" the tab is not removed.
     * @param tabId {number} Id of the tab where the error occurred.
     * @param error {string} Type of error.
     */
    let handleError = function (tabId, error) {
        let unverifiedBookmark = tabRegistry[tabId];

        if (typeof unverifiedBookmark !== 'undefined') {
            // Keep on loading on redirect. The tab is likely to complete successfully.
            if (error !== ERROR_BINDING_ABORTED) {
                browser.tabs.remove(tabId);
            }
            errorCount++;
            setStats();
            appendErrorMessage(unverifiedBookmark, error);
        }
    };

    /**
     * Handles request errors where the corresponding tab id is known or unknown (-1).
     * @param details {{}} Details from {browser.webRequest.onCompleted}.
     * @param error {string} Type of error.
     */
    let handleRequestError = function (details, error) {
        // Url-error-relation might be need by onNavigationCompleted if the tab id is -1.
        tabRequestMap[details.url] = error;
        if (details.tabId !== -1) {
            handleError(details.tabId, error);
        }
    };

    /**
     * Appends an error message for a duplicated bookmark to the UI.
     * @param bookmark {browser.bookmarks.BookmarkTreeNode}
     */
    let reportDuplicate = function (bookmark) {
        if (typeof bookmark !== 'undefined') {
            errorCount++;
            appendErrorMessage(bookmark, ERROR_DUPLICATE);
        }
    };

    /**
     * Appends an error message to the messages-list of the UI.
     * @param bookmark {browser.bookmarks.BookmarkTreeNode} Invalid bookmark.
     * @param error {string} Type of error.
     */
    let appendErrorMessage = function (bookmark, error) {
        const messageContainer = document.createElement('div');
        messageContainer.id = bookmark.id;
        messageContainer.className = 'message';
        messageContainer.append(createActionIcons(bookmark));
        messageContainer.append(createIcon(ERROR_TYPE_TO_ICON[error], 'error', error.replace(/_/g, ' ')));
        messageContainer.append(document.createTextNode(bookmark.title.toLowerCase()));

        MESSAGES.append(messageContainer);
    };

    /**
     * Creates action icons for an invalid bookmark.
     * @param bookmark {browser.bookmarks.BookmarkTreeNode}
     * @returns {HTMLElement}
     */
    let createActionIcons = function (bookmark) {
        const actionContainer = document.createElement('span');

        const deleteFromBookmarksIcon = createIcon('delete', 'button');
        deleteFromBookmarksIcon.addEventListener('click', () => {
            if (removalConfirmed) {
                removeBookmark(bookmark.id, true);
            } else {
                modalBookmarkId = bookmark.id;
                MODAL.style.display = 'block';
                MODAL_WARNING.style.display = 'block';
                MODAL_HELP.style.display = 'none';
            }
        });
        actionContainer.append(deleteFromBookmarksIcon);

        const deleteFromListIcon = createIcon('check_circle', 'button');
        deleteFromListIcon.addEventListener('click', () => {
            removeBookmark(bookmark.id, false);
        });
        actionContainer.append(deleteFromListIcon);

        const launchIcon = createIcon('launch', 'button');
        launchIcon.addEventListener('click', () => {
            browser.tabs.create({url: bookmark.url});
        });
        actionContainer.append(launchIcon);

        return actionContainer;
    };

    /**
     * Creates tooltip icons for error types or simple icons for actions.
     * @param iconId {string} Id of the material icon.
     * @param cssClass {string} (Optional) Additional CSS class
     * @param tooltip {string} (Optional) Tooltip for the icon.
     * @returns {HTMLElement}
     */
    let createIcon = function (iconId, cssClass, tooltip) {
        let icon;

        const simpleIcon = document.createElement('i');
        simpleIcon.classList = 'material-icons icon';
        simpleIcon.append(document.createTextNode(iconId));

        if (typeof cssClass !== 'undefined' && cssClass !== '') {
            simpleIcon.classList.add(cssClass);
        }

        if (typeof tooltip !== 'undefined') {
            const tooltipIconContainer = document.createElement('div');
            const tooltipTextContainer = document.createElement('span');
            const tooltipText = document.createTextNode(tooltip);

            tooltipIconContainer.className = 'tooltip-container';
            tooltipTextContainer.className = 'tooltip-text';

            tooltipTextContainer.append(tooltipText);

            tooltipIconContainer.append(simpleIcon);
            tooltipIconContainer.append(tooltipTextContainer);

            icon = tooltipIconContainer;
        } else {
            icon = simpleIcon;
        }

        return icon;
    };

    /**
     * Displays statistics for scanned bookmarks (total, ignored, problems).
     */
    let setStats = function () {
        STATS.style.display = 'block';
        STATS.innerHTML = '<b>Total:</b> ' + (bookmarksToProcess + bookmarksIgnored.length)
            + ' <b>Ignored:</b> ' + bookmarksIgnored.length
            + ' <b>Problems:</b> ' + errorCount;
    };

    /**
     * Displays a favicon beyond the progress bar for limited period of time.
     * @param favIconUrl {string} Source of the favicon
     */
    let setFavicon = function (favIconUrl) {
        // preload
        const image = new Image();
        image.src = favIconUrl;

        const favIcon = document.createElement('img');
        favIcon.src = image.src;
        favIcon.alt = '';
        favIcon.className = 'favicon';
        favIcon.crossOrigin = 'anonymous';
        FAVICONS.prepend(favIcon);
        FAVICONS.style.display = 'block';
        MESSAGES.style.marginTop = '140px';
    };

    /**
     * Removes a bookmark from the UI list or permanently (from the profile).
     * @param id {string} Id of the bookmark that is to be removed.
     * @param permanently {boolean} Flag to indicate whether the bookmark should be removed permanently.
     */
    let removeBookmark = function (id, permanently) {
        if (permanently) {
            browser.bookmarks.remove(id)
                .then(() => {
                    document.getElementById(id).remove();
                    errorCount--;
                    setStats();
                }, (error) => {
                    // After a reported redirection another error may occur for the same bookmark which results in
                    // two entries in the UI.
                    console.warn(`WARNING: Could not remove bookmark ${id}: ${error}; Already removed before?`);
                });
        } else {
            document.getElementById(id).remove();
            errorCount--;
            setStats();
        }
    };

    /**
     * Transforms a comma separated string into an array of options.
     * @param option {string} Raw comma separated string.
     * @returns {string[]} Array of options.
     */
    let getOptionsArray = function (option) {
        return option
            .split(',')
            .map(x => x.trim())
            .filter(x => x !== '');
    };
}

const remarksSidebar = new RemarksSidebar();
remarksSidebar.init();