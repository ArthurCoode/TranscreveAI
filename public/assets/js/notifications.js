class NotificationManager {

    constructor() {

        this.notifications =
            JSON.parse(
                localStorage.getItem(
                    "notifications"
                )
            ) || [];

        this.dropdown =
            document.getElementById(
                "notificationDropdown"
            );

        this.list =
            document.getElementById(
                "notificationList"
            );

        this.count =
            document.getElementById(
                "notificationCount"
            );

        this.button =
            document.getElementById(
                "notificationBtn"
            );

        this.clearBtn =
            document.getElementById(
                "clearAllNotif"
            );

        this.activeTab = "all";

        /* remove antigas (>7 dias) */
        this.notifications =
            this.notifications.filter(
                n =>
                    Date.now()
                    -
                    new Date(
                        n.createdAt
                    ).getTime()
                    <
                    (
                        7 *
                        24 *
                        60 *
                        60 *
                        1000
                    )
            );

        localStorage.setItem(
            "notifications",
            JSON.stringify(
                this.notifications
            )
        );

        this.init();

    }

    init() {

        this.button
        ?.addEventListener(
            "click",
            () => {

                this.dropdown
                ?.classList.toggle(
                    "active"
                );

            }
        );

        this.clearBtn
        ?.addEventListener(
            "click",
            () =>
                this.clear()
        );

        document.addEventListener(
            "click",
            (e) => {

                if (

                    this.dropdown &&

                    this.button &&

                    !this.dropdown.contains(
                        e.target
                    )

                    &&

                    !this.button.contains(
                        e.target
                    )

                ) {

                    this.dropdown
                    .classList
                    .remove(
                        "active"
                    );

                }

            }
        );

        document
        .querySelectorAll(
            ".notification-tab"
        )
        .forEach(
            tab => {

                tab.addEventListener(
                    "click",
                    () => {

                        document
                        .querySelectorAll(
                            ".notification-tab"
                        )
                        .forEach(
                            t =>
                            t.classList.remove(
                                "active"
                            )
                        );

                        tab.classList.add(
                            "active"
                        );

                        this.activeTab =
                            tab.dataset.notifTab;

                        this.render();

                    }
                );

            }
        );

        this.render();

    }

    add(data) {

        const exists =
            this.notifications.some(
                n =>

                    n.title ===
                    data.title

                    &&

                    n.message ===
                    data.message
            );

        if (exists)
            return;

        const notification = {

            id:
                Date.now(),

            title:
                data.title,

            message:
                data.message,

            icon:
                data.icon ||
                "fa-bell",

            type:
                data.type ||
                "info",

            read:
                false,

            createdAt:
                new Date()

        };

        this.notifications.unshift(
            notification
        );

        /* limite */
        this.notifications =
            this.notifications.slice(
                0,
                50
            );

        this.save();

    }

    markRead(id) {

        const item =
            this.notifications.find(
                n =>
                    n.id === id
            );

        if (
            item
        ) {

            item.read =
                true;

        }

        this.save();

    }

    markAllRead() {

        this.notifications.forEach(
            n =>
                n.read =
                true
        );

        this.save();

    }

    clear() {

        this.notifications =
            [];

        this.save();

    }

    save() {

        localStorage.setItem(

            "notifications",

            JSON.stringify(
                this.notifications
            )

        );

        this.render();

    }

    render() {

        if (
            !this.list
        )
            return;

        this.list.innerHTML =
            "";

        const filtered =

            this.activeTab ===
            "unread"

            ?

            this.notifications.filter(
                n =>
                    !n.read
            )

            :

            this.notifications;

        if (
            !filtered.length
        ) {

            this.list.innerHTML =
                `
                <div class="empty">
                    Sem notificações
                </div>
                `;

        }

        else {

            filtered.forEach(
                item => {

                    const div =
                        document.createElement(
                            "div"
                        );

                    div.className =
                        `
                        notification-item
                        ${
                            item.read
                            ? ""
                            : "unread"
                        }
                        `;

                    div.innerHTML =

                    `
                    <div class="notif-icon">

                        <i class="fas ${item.icon}"></i>

                    </div>

                    <div>

                        <strong>
                            ${escHtml(item.title)}
                        </strong>

                        <p>
                            ${escHtml(item.message)}
                        </p>

                        <small>
                            ${this.timeAgo(
                                item.createdAt
                            )}
                        </small>

                    </div>
                    `;

                    div.onclick =
                    () =>
                        this.markRead(
                            item.id
                        );

                    this.list.appendChild(
                        div
                    );

                });

        }

        const unread =

            this.notifications
            .filter(
                n =>
                    !n.read
            )
            .length;

        if (
            this.count
        ) {

            this.count.textContent =
                unread;

            this.count.style.display =

                unread

                ?

                "flex"

                :

                "none";

        }

    }

    timeAgo(date) {

        const diff =

            Math.floor(

                (

                    Date.now()

                    -

                    new Date(
                        date
                    )

                )

                /

                60000

            );

        if (
            diff < 1
        )
            return "Agora";

        if (
            diff < 60
        )
            return `${diff} min`;

        if (
            diff < 1440
        )
            return `${Math.floor(diff/60)} h`;

        return `${Math.floor(diff/1440)} d`;

    }

}

window.notifications =
    new NotificationManager();