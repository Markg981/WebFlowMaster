/**
 * What the product calls itself.
 *
 * It was written by hand in three places and they disagreed: the sign-in screen said
 * "WebFlowMaster", the sidebar said "WebTest Platform", and the breadcrumb said whatever the
 * workspace setting held. A person who signs in and then looks at the sidebar should not
 * have to wonder whether they are in the same application.
 *
 * The two halves are separate because the wordmark sets the second one in the brand colour;
 * building the full name from them means the two cannot drift apart.
 */
export const PRODUCT_NAME_PREFIX = 'WebFlow';
export const PRODUCT_NAME_SUFFIX = 'Master';
export const PRODUCT_NAME = `${PRODUCT_NAME_PREFIX}${PRODUCT_NAME_SUFFIX}`;
