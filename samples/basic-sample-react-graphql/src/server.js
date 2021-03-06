/* global __BUNDLE_OUTPUT_PATH__ */
/* global __SC_GRAPHQL_ENDPOINT__ */

import React from 'react';
import ReactDOM from 'react-dom/server';
import { renderToStringWithData } from 'react-apollo';
import { StaticRouter } from 'react-router-dom';
import initialState from './boot/initialState';
import Root from './boot/Root';
import SitecoreContentService from './boot/SitecoreContentService';
import SitecoreContextFactory from './boot/SitecoreContextFactory';
import GraphQLClientFactory from '../lib/GraphQL/SubscriptionGraphQLClientFactory';
import ServerHtml from './app/ServerHtml';

/*
  Main entry point to the application when run on a Node server.
  The renderView() function will be invoked by Sitecore's view engine
  to provide the data to render with.
*/

export function renderView(callback, path, data, viewBag) {
  try {
    // push the server-provided state into the data provider
    const state = parseServerData(data, viewBag);
    SitecoreContentService.setInitialRouteData(state);

    const graphQLClient = GraphQLClientFactory(__SC_GRAPHQL_ENDPOINT__, true);

    // get the route data and then render from it
    SitecoreContentService.getRouteData(path)
      // render the app to a string using Apollo Client's SSR helper (waits for all GraphQL queries to complete)
      .then((routeData) => {
        SitecoreContextFactory.setSitecoreContext({
          route: routeData.sitecore.route,
          itemId: routeData.sitecore.route.itemId,
          ...routeData.sitecore.context,
        });
        return renderToStringWithData(
          <Root
            initialState={routeData}
            path={path}
            graphQLClient={graphQLClient}
            Router={StaticRouter}
          />
        );
      })
      .then((content) => {
        // wrap the app content in a HTML shell (ServerHtml), and return it to the server
        const result = {
          html: null,
          status: 200,
          redirect: null,
        };

        // <ServerHtml> is the HTML wrapper (head, etc) around the app contents when SSR-ing
        result.html = ReactDOM.renderToString(
          <ServerHtml
            content={content}
            initialState={state}
            initialGraphQLState={graphQLClient.cache.extract()}
            distPath={__BUNDLE_OUTPUT_PATH__}
          />
        );
        callback(null, result);
      })
      .catch((error) => {
        // when GraphQL errors occur during SSR it may be multiple errors.
        // returning just the error hides the internal error details,
        // so we write them to console before calling back so they go into the Sitecore logs
        // (if only one error occurs it's not bundled; see https://github.com/apollographql/react-apollo/blob/30d8adea5627c44bbfc6b332f23abc6f43477d5e/src/getDataFromTree.ts#L183)
        if (error.queryErrors && error.queryErrors.length > 1) {
          // eslint-disable-next-line no-console
          error.queryErrors.forEach((queryError) => console.error(queryError));
          // eslint-disable-next-line no-param-reassign
          error.message += ' See the Sitecore logs preceding this error for details.';
        }
        // signals the server that we had an error rendering
        callback(error, null);
      });
  } catch (err) {
    // need to ensure the callback is always invoked no matter what
    // or else SSR will hang
    callback(err, null);
  }
}

function parseServerData(data, viewBag) {
  /*
    Data from server is double-encoded since MS JSS does not allow control
    over JSON serialization format.
  */
  const parsedData = data instanceof Object ? data : JSON.parse(data);
  const parsedViewBag = viewBag instanceof Object ? viewBag : JSON.parse(viewBag);

  const state = initialState();
  state.viewBag = parsedViewBag;

  if (parsedData) {
    state.sitecore = parsedData.sitecore;
  }

  return state;
}
