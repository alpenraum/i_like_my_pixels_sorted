/*
 *              ##############
 *          ######          #####
 *         ####                ####
 *       ###                     ####
 *      ##                         ###
 *     ##                           ##
 *    ###                            ##
 *    ##                             ##
 *    ##                              ##
 *    ##                              ##
 *     ##                             ##
 *     ###                           ###
 *       ###                         ###
 *         #######                   ###
 *            #####      ##   #   ## ##
 *                ##     ##  ##   #####
 *                 ##    ##   #   ####
 *                 ###################
 */

import { render } from 'preact';
import { App } from './App.tsx';

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && !('__TAURI_INTERNALS__' in globalThis)) {
  navigator.serviceWorker.register('sw.js');
}
