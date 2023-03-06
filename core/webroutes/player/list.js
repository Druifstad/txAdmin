const modulename = 'WebServer:PlayerList';
import humanizeDuration from 'humanize-duration';
import { processActionList, processPlayerList } from './processor';
import logger from '@core/extras/console.js';
import { verbose } from '@core/globalData';
const { dir, log, logOk, logWarn, logError } = logger(modulename);


/**
 * Returns the output page containing the action log, and the console log
 *
 * TODO: Return last players
 * FIXME: Add Caching ASAP. This is a _very_ expensive method.
 *
 * @param {object} ctx
 */
export default async function PlayerList(ctx) {
    //Prepare dbo
    const dbo = globals.playerDatabase.getDb();

    const timeStart = new Date();
    const controllerConfigs = globals.playerDatabase.config;
    const queryLimits = {
        actions: 20,
        players: 30,
    };
    const respData = {
        headerTitle: 'Players',
        stats: getStats(),
        queryLimits,
        lastActions: await getLastActions(dbo, queryLimits.actions),
        lastPlayers: await getLastPlayers(dbo, queryLimits.players),
        disableBans: !controllerConfigs.onJoinCheckBan,
        permsDisable: {
            ban: !ctx.utils.hasPermission('players.ban'),
            warn: !ctx.utils.hasPermission('players.warn'),
        },
    };

    //Output
    const timeElapsed = new Date() - timeStart;
    respData.message = `Executed in ${timeElapsed} ms`;
    return ctx.utils.render('main/playerList', respData);
};


/**
 * Get stats on actions and players
 */
function getStats() {
    try {
        const stats = globals.playerDatabase.getDatabaseStats();
        const playTimeSeconds = stats.playTime * 60 * 1000;
        let humanizeOptions = {
            round: true,
            units: ['y', 'd', 'h'],
            largest: 2,
            spacer: '',
            language: 'shortEn',
            languages: {
                shortEn: {
                    y: () => 'y',
                    d: () => 'd',
                    h: () => 'h',
                },
            },
        };
        const playTime = humanizeDuration(playTimeSeconds, humanizeOptions);

        return {
            players: stats.players.toLocaleString(),
            playTime: playTime,
            bans: stats.bans.toLocaleString(),
            warns: stats.warns.toLocaleString(),
            whitelists: stats.whitelists.toLocaleString(),
        };
    } catch (error) {
        const msg = `getStats failed with error: ${error.message}`;
        if (verbose) logError(msg);
        return [];
    }
}


/**
 * Get the last actions from the end of the list.
 * NOTE: this is not being sorted by timestamp, we are assuming its ordered.
 * @param {object} dbo
 * @param {number} limit
 * @returns {array} array of processed actions, or [] on error
 */
async function getLastActions(dbo, limit) {
    try {
        const lastActions = await dbo.chain.get('actions')
            .takeRight(limit)
            .reverse()
            .cloneDeep()
            .value();
        return await processActionList(lastActions);
    } catch (error) {
        const msg = `getLastActions failed with error: ${error.message}`;
        if (verbose) logError(msg);
        return [];
    }
}


/**
 * Get the last actions from the end of the list.
 * NOTE: this is not being sorted by timestamp, we are assuming its ordered.
 * @param {object} dbo
 * @param {number} limit
 * @returns {array} array of processed actions, or [] on error
 */
async function getLastPlayers(dbo, limit) {
    try {
        const lastPlayers = await dbo.chain.get('players')
            .takeRight(limit)
            .reverse()
            .cloneDeep()
            .value();
        return await processPlayerList(lastPlayers);
    } catch (error) {
        const msg = `getLastPlayers failed with error: ${error.message}`;
        if (verbose) logError(msg);
        return [];
    }
}
