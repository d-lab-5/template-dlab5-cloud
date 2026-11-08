import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { Shell } from "../components/Shell";

const NotFoundPage: React.FC<PageProps> = () => (
  <Shell>
    <h1>Not found</h1>
    <p>
      <a href="/">Back to spaces</a>
    </p>
  </Shell>
);

export default NotFoundPage;

export const Head: HeadFC = () => <title>Not found · template.dlab5</title>;
