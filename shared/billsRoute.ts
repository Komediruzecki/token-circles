/**
 * Bills with the subscription scan open: `#bills?scan=1`.
 *
 * Getting started's subscription step and the Welcome mail's "Find your subscriptions" open this
 * address, and Bills runs the scan on its Subscriptions tab (features/Bills.tsx). The Welcome
 * linked `#bills` before, which opened the list of bills and left the scan to be found. Shared, so
 * the Worker's mails and the app's steps name the same address.
 */

export const SUBSCRIPTION_SCAN_HASH = '#bills?scan=1';
