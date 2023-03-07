const modulename = 'DiscordBot:cmd:status';
import humanizeDuration from 'humanize-duration';
import { ChannelType, ChatInputCommandInteraction, ColorResolvable, EmbedBuilder } from 'discord.js';
import logger from '@core/extras/console.js';
import TxAdmin from '@core/txAdmin';
import { cloneDeep } from 'lodash-es';
import { embedder, ensurePermission, isValidEmbedUrl, logDiscordAdminAction } from '../discordHelpers';
const { dir, log, logOk, logWarn, logError } = logger(modulename);

//Humanizer options
const humanizer = humanizeDuration.humanizer({
    round: true,
    units: ['d', 'h', 'm'],
    largest: 2,
    // spacer: '',
    language: 'shortEn',
    languages: {
        shortEn: {
            d: () => "dagen",
            h: () => "uur",
            m: () => "minuten",
        },
    },
});

export const generateStatusMessage = (
    txAdmin: TxAdmin,
    rawEmbedJson: string = txAdmin.discordBot.config.embedJson,
    rawEmbedConfigJson: string = txAdmin.discordBot.config.embedConfigJson
) => {
    //Parsing decoded JSONs
    let embedJson;
    try {
        embedJson = JSON.parse(rawEmbedJson);
        if (!(embedJson instanceof Object)) throw new Error(`not an Object`);
    } catch (error) {
        throw new Error(`Embed JSON Error: ${(error as Error).message}`);
    }

    let embedConfigJson;
    try {
        embedConfigJson = JSON.parse(rawEmbedConfigJson);
        if (!(embedConfigJson instanceof Object)) throw new Error(`not an Object`);
    } catch (error) {
        throw new Error(`Embed Config JSON Error: ${(error as Error).message}`);
    }

    //Prepare placeholders
    //NOTE: serverCfxId can be undefined, breaking the URLs, but there is no easy clean way to deal with this issue
    const serverCfxId = txAdmin.persistentCache.get('fxsRuntime:cfxId');
    const placeholders = {
        serverName: txAdmin.globalConfig.serverName,
        statusString: 'Unknown',
        statusColor: '#7744aa',
        serverCfxId,
        serverBrowserUrl: `https://servers.fivem.net/servers/detail/${serverCfxId}`,
        serverJoinUrl: `fivem://connect/druifstad.nl:30120`,
        serverMaxClients: txAdmin.persistentCache.get('fxsRuntime:maxClients') ?? 'unknown',
        serverClients: txAdmin.playerlistManager.onlineCount,
        nextScheduledRestart: 'unknown',
        uptime: (txAdmin.healthMonitor.currentStatus === 'ONLINE')
            ? humanizer(txAdmin.fxRunner.getUptime() * 1000)
            : '--',
    }

    //Prepare scheduler placeholder
    const schedule = txAdmin.scheduler.getStatus();
    if (typeof schedule.nextRelativeMs !== 'number') {
        placeholders.nextScheduledRestart = 'not scheduled';
    } else if (schedule.nextSkip) {
        placeholders.nextScheduledRestart = 'skipped';
    } else {
        const tempFlag = (schedule.nextIsTemp) ? '(tmp)' : '';
        const relativeTime = humanizer(schedule.nextRelativeMs);
        const isLessThanMinute = schedule.nextRelativeMs < 60_000;
        if (isLessThanMinute) {
            placeholders.nextScheduledRestart = `right now ${tempFlag}`;
        } else {
            placeholders.nextScheduledRestart = `in ${relativeTime} ${tempFlag}`;
        }
    }

    //Prepare status placeholders
    if (txAdmin.healthMonitor.currentStatus === 'ONLINE') {
        placeholders.statusString = embedConfigJson?.onlineString ?? '🟢 Online';
        placeholders.statusColor = embedConfigJson?.onlineColor ?? "#7744aa";
    } else if (txAdmin.healthMonitor.currentStatus === 'PARTIAL') {
        placeholders.statusString = embedConfigJson?.partialString ?? '🟡 Partial';
        placeholders.statusColor = embedConfigJson?.partialColor ?? "#7744aa";
    } else if (txAdmin.healthMonitor.currentStatus === 'OFFLINE') {
        placeholders.statusString = embedConfigJson?.offlineString ?? '🔴 Offline';
        placeholders.statusColor = embedConfigJson?.offlineColor ?? "#7744aa";
    }

    //Processing embed
    function replacePlaceholders(inputString: string) {
        Object.entries(placeholders).forEach(([key, value]) => {
            inputString = inputString.replaceAll(`{{${key}}}`, String(value));
        });
        return inputString;
    }
    function processValue(inputValue: any): any {
        if (typeof inputValue === 'string') {
            return replacePlaceholders(inputValue);
        } else if (Array.isArray(inputValue)) {
            return inputValue.map((arrValue) => processValue(arrValue));
        } else if (inputValue !== null && typeof inputValue === 'object') {
            return processObject(inputValue);
        } else {
            return inputValue;
        }
    }
    function processObject(inputData: object) {
        const input = cloneDeep(inputData);
        const out: any = {};
        for (const [key, value] of Object.entries(input)) {
            const processed = processValue(value);
            if(key === 'url' && !isValidEmbedUrl(processed)){
                throw new Error(`Invalid URL \`${processed}\`.
                Every URL must start with one of ('http://', 'https://', 'discord://').`);
            }
            out[key] = processed;
        }
        return out;
    }
    const processedEmbedData = processObject(embedJson);

    //Attempting to instantiate embed class
    let embed;
    try {
        embed = new EmbedBuilder(processedEmbedData);
        embed.setColor(placeholders.statusColor as ColorResolvable);
        embed.setTimestamp();
    } catch (error) {
        throw new Error(`Embed Class Error: ${(error as Error).message}`);
    }

    return {
        embeds: [embed],
    };
}

export const removeOldEmbed = async (interaction: ChatInputCommandInteraction, txAdmin: TxAdmin) => {
    const oldChannelId = txAdmin.persistentCache.get('discord:status:channelId');
    const oldMessageId = txAdmin.persistentCache.get('discord:status:messageId');
    if (typeof oldChannelId === 'string' && typeof oldMessageId === 'string') {
        const oldChannel = await interaction.client.channels.fetch(oldChannelId);
        if (oldChannel?.type === ChannelType.GuildText) {
            await oldChannel.messages.delete(oldMessageId);
        } else {
            throw new Error(`oldChannel is not a guild text channel`);
        }
    } else {
        throw new Error(`no old message id saved, maybe was never sent, maybe it was removed`);
    }
}

export default async (interaction: ChatInputCommandInteraction, txAdmin: TxAdmin) => {
    //Check permissions
    const adminName = await ensurePermission(interaction, txAdmin, 'settings.write');
    if (typeof adminName !== 'string') return;

    //Attempt to remove old message
    const isRemoveOnly = (interaction.options.getSubcommand() === 'remove');
    try {
        await removeOldEmbed(interaction, txAdmin);
        txAdmin.persistentCache.delete('discord:status:channelId');
        txAdmin.persistentCache.delete('discord:status:messageId');
        if (isRemoveOnly) {
            const msg = `Old status embed removed.`;
            logDiscordAdminAction(txAdmin, adminName, msg);
            return await interaction.reply(embedder.success(msg, true));
        }
    } catch (error) {
        if (isRemoveOnly) {
            return await interaction.reply(
                embedder.warning(`**Failed to remove old status embed:**\n${(error as Error).message}`, true)
            );
        }
    }

    //Generate new message
    let newStatusMessage;
    try {
        newStatusMessage = generateStatusMessage(txAdmin);
    } catch (error) {
        return await interaction.reply(
            embedder.warning(`**Failed to generate new embed:**\n${(error as Error).message}`, true)
        );
    }

    //Attempt to send new message
    try {
        if (interaction.channel?.type !== ChannelType.GuildText) throw new Error(`channel type not supported`);
        const placeholderEmbed = new EmbedBuilder({
            description: '_placeholder message, attempting to edit with embed..._\n**Note:** If you are seeing this message, it probably means that something was wrong with the configured Embed JSONs and Discord\'s API rejected the request to replace this placeholder.'
        })
        const newMessage = await interaction.channel.send({ embeds: [placeholderEmbed] });
        await newMessage.edit(newStatusMessage);
        txAdmin.persistentCache.set('discord:status:channelId', interaction.channelId);
        txAdmin.persistentCache.set('discord:status:messageId', newMessage.id);
    } catch (error) {
        return await interaction.reply(
            embedder.warning(`**Failed to send new embed:**\n${(error as Error).message}`, true)
        );
    }

    const msg = `Status embed saved.`;
    logDiscordAdminAction(txAdmin, adminName, msg);
    return await interaction.reply(embedder.success(msg, true));
}
