import type { GatsbyNode } from "gatsby";

/**
 * `node:` builtins are left as runtime requires, for the SSR bundle only.
 *
 * The HTML renderer runs in Node, so bundling them is neither necessary nor
 * possible — webpack fails outright with "Reading from node:sqlite is not
 * handled by plugins". They reach the module graph through a transitive
 * dependency of aws-amplify that guards its use at runtime, which webpack
 * cannot see.
 */
export const onCreateWebpackConfig: GatsbyNode["onCreateWebpackConfig"] = ({
  stage,
  actions,
}) => {
  if (stage !== "build-html" && stage !== "develop-html") return;

  actions.setWebpackConfig({
    externals: [
      (
        { request }: { request?: string },
        callback: (err?: unknown, result?: string) => void
      ) =>
        request?.startsWith("node:")
          ? callback(undefined, `commonjs ${request}`)
          : callback(),
    ],
  });
};

/**
 * Space routes are client-only.
 *
 * A space's content is authenticated per-Cognito-group data living in S3,
 * so there is nothing to statically render and no build-time list of ids to
 * render it from. `matchPath` lets Gatsby serve /w/<id>/... from a single
 * page component that reads the id at runtime.
 *
 * This has a consequence OUTSIDE this repository: no file exists at
 * /w/<id>/, so Amplify Hosting needs an explicit 200 rewrite ahead of its
 * catch-all. See constraint 11 in the dlab5-cloud-template skill. Adding another client-only route
 * here means adding another hosting rule there.
 */
export const onCreatePage: GatsbyNode["onCreatePage"] = async ({
  page,
  actions,
}) => {
  if (page.path === "/w/") {
    actions.deletePage(page);
    actions.createPage({ ...page, matchPath: "/w/*" });
  }
};
