
/*
The MIT License

Copyright (c) 2015 Resin.io, Inc. https://resin.io.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
 */

/**
 * @module request
 */
var Promise, errors, estimate, prepareOptions, progress, request, requestAsync, settings, stream, token, url, utils, _;

Promise = require('bluebird');

stream = require('stream');

request = require('request');

requestAsync = Promise.promisify(request);

progress = require('request-progress');

url = require('url');

_ = require('lodash');

errors = require('resin-errors');

settings = require('resin-settings-client');

token = require('resin-token');

utils = require('./utils');

estimate = require('./estimate');

prepareOptions = function(options) {
  if (options == null) {
    options = {};
  }
  _.defaults(options, {
    method: 'GET',
    gzip: true,
    json: true,
    headers: {},
    refreshToken: true
  });
  options.url = url.resolve(settings.get('apiUrl'), options.url);
  return Promise["try"](function() {
    if (!options.refreshToken) {
      return;
    }
    return utils.shouldUpdateToken().then(function(shouldUpdateToken) {
      if (!shouldUpdateToken) {
        return;
      }
      return exports.send({
        url: '/whoami',
        refreshToken: false
      }).get('body').then(token.set);
    });
  }).then(utils.getAuthorizationHeader).then(function(authorizationHeader) {
    if (authorizationHeader != null) {
      options.headers.Authorization = authorizationHeader;
    }
    return options;
  });
};


/**
 * @summary Perform an HTTP request to Resin.io
 * @function
 * @public
 *
 * @description
 * This function automatically handles authorizacion with Resin.io.
 * If you don't have a token, the request is made anonymously.
 * This function automatically prepends the Resin.io host, therefore you should pass relative urls.
 *
 * @param {Object} options - options
 * @param {String} [options.method='GET'] - method
 * @param {String} options.url - relative url
 * @param {*} [options.body] - body
 *
 * @returns {Promise<Object>} response
 *
 * @example
 * request.send
 * 	method: 'GET'
 * 	url: '/foo'
 * .get('body')
 *
 * @example
 * request.send
 * 	method: 'POST'
 * 	url: '/bar'
 * 	data:
 * 		hello: 'world'
 * .get('body')
 */

exports.send = function(options) {
  if (options == null) {
    options = {};
  }
  return prepareOptions(options).then(requestAsync).spread(function(response) {
    var responseError;
    if (utils.isErrorCode(response.statusCode)) {
      responseError = utils.getErrorMessageFromResponse(response);
      throw new errors.ResinRequestError(responseError);
    }
    return response;
  });
};


/**
 * @summary Stream an HTTP response from Resin.io.
 * @function
 * @public
 *
 * @description
 * This function emits a `progress` event, passing an object with the following properties:
 *
 * - `Number percent`: from 0 to 100.
 * - `Number total`: total bytes to be transmitted.
 * - `Number received`: number of bytes transmitted.
 * - `Number eta`: estimated remaining time, in seconds.
 *
 * The stream may also contain the following custom properties:
 *
 * - `Number .length`: Calculated from the `Content-Length` HTTP header.
 * - `String .mime`: Equals the value of the `Content-Type` HTTP header.
 *
 * @param {Object} options - options
 * @param {String} [options.method='GET'] - method
 * @param {String} options.url - relative url
 * @param {*} [options.body] - body
 *
 * @returns {Promise<Stream>} response
 *
 * @example
 * request.stream
 * 	method: 'GET'
 * 	url: '/download/foo'
 * .then (stream) ->
 * 	stream.on 'progress', (state) ->
 * 		console.log(state)
 *
 *		stream.pipe(fs.createWriteStream('/opt/download'))
 */

exports.stream = function(options) {
  if (options == null) {
    options = {};
  }
  return prepareOptions(options).then(function(processedOptions) {
    return new Promise(function(resolve, reject) {
      var download, estimator, pass;
      download = progress(request(processedOptions));
      pass = new stream.PassThrough();
      download.pipe(pass);
      estimator = estimate.getEstimator();
      download.on('progress', function(state) {
        return pass.emit('progress', estimator(state));
      });
      download.on('response', function(response) {
        return pass.emit('response', response);
      });
      return pass.on('response', function(response) {
        if (!utils.isErrorCode(response.statusCode)) {
          pass.length = _.parseInt(response.headers['content-length']) || void 0;
          pass.mime = response.headers['content-type'];
          return resolve(pass);
        }
        return utils.getStreamData(pass).then(function(data) {
          var responseError;
          responseError = data || utils.getErrorMessageFromResponse(response);
          return reject(new errors.ResinRequestError(responseError));
        });
      });
    });
  });
};
