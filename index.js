const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    SlashCommandBuilder
} = require('discord.js');

const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');


// ================== CONFIG ==================

const TOKEN = process.env.TOKEN;
const GUILD_ID = '1171203356627325020';

const VOICE_CHANNEL_ID = '1171227456355717171';
const LOG_CHANNEL_ID = '1504642945805058108';

const TOP_CHANNEL_ID = '1504638369320275969';       // 🏆 Top 5
const LIST_CHANNEL_ID = '1504642738468032603';  // 📊 listado completo

const PANEL_POSTULACIONES_ID = '1190361131403989012';
const POSTULACIONES_CHANNEL_ID = '1505088263151554621';
const PANEL_CHANNEL_ID = '1504642028611436625';
const ADMIN_ROLE_ID = '1463173572209152182';
const MOD_ROLE_ID = '1504658756875587604';

const ROLE_ID = '1462189103381483697';
const SERVICE_ROLE_ID = '1504659324503457942';
const ADMIN_PANEL_CHANNEL_ID = '1504659808681332877';

const REWARD_ROLE_ID = '1462189103381483697';
const REWARD_CHANNEL_ID = '1504638498295119882';

const REWARD_WINNERS_CHANNEL_ID = '1504638498295119882';

const SANCTION_LOG_CHANNEL_ID = '1504659808681332877';
const PUBLIC_SANCTION_CHANNEL_ID = '1464785677697810543';

const APROBADOS_CHANNEL_ID = '1504724107332157510';
const POSTULANTE_ROLE_ID = '1462599489729728603';
const DESPEDIDO_ROLE_ID = '1462190071037034518';
const DESPEDIDOS_CHANNEL_ID = '1466942656713195552';

const POSTULACIONES_ROLE_ID = '1492269491264950524';
// ================== CLIENT ==================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ]
});

// ================= DB =================

const db = new sqlite3.Database('/data/medica.db');

db.run(`CREATE TABLE IF NOT EXISTS sanctions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    type TEXT,
    reason TEXT,
    admin_id TEXT,
    date TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS weekly_time (
    user_id TEXT,
    week TEXT,
    total_time INTEGER,
    PRIMARY KEY(user_id, week)
)`);

db.run(`CREATE TABLE IF NOT EXISTS active_sessions (
    user_id TEXT PRIMARY KEY,
    start_time INTEGER,
    channel_name TEXT
)`);

db.run(`
CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    reward TEXT,
    description TEXT,
    required_hours INTEGER,
    created_at INTEGER,
    active INTEGER DEFAULT 1
)
`);

db.run(`
CREATE TABLE IF NOT EXISTS reward_winners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    reward_name TEXT,
    date TEXT
)
`);

db.run(`
CREATE TABLE IF NOT EXISTS session_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    start_time INTEGER,
    end_time INTEGER,
    duration INTEGER
)
`);

db.run(`CREATE TABLE IF NOT EXISTS admin_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    action TEXT,
    admin_id TEXT,
    date TEXT
)`);

db.run(`
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    duration INTEGER,
    created_at INTEGER
)
`);
      
// ================= VARIABLES =================

const sessionTime = new Map();
const activeUsers = new Set();
const reminderCooldown = new Map();

// ================= UTILS =================

function formatTime(seconds) {

    const h =
        Math.floor(seconds / 3600);

    const m =
        Math.floor(
            (seconds % 3600) / 60
        );

    const sec =
        seconds % 60;

    return [h, m, sec]
        .map(x =>
            String(x).padStart(2, '0')
        )
        .join(':');
}
function formatHour(timestamp) {

    return new Date(timestamp).toLocaleTimeString(
        'es-UY',
        {
            timeZone:
                'America/Montevideo',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        }
    );
}

function formatDate() {

    const now = new Date();

    const dias = [
        'Domingo',
        'Lunes',
        'Martes',
        'Miércoles',
        'Jueves',
        'Viernes',
        'Sábado'
    ];

    const dia = dias[now.getDay()];

    const fecha = now.toLocaleDateString('es-UY', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });

    return `${dia} ${fecha}`;
}

function getWeek() {

    const d = new Date();

    const oneJan = new Date(d.getFullYear(), 0, 1);

    const num = Math.floor((d - oneJan) / 86400000);

    return `${d.getFullYear()}-W${Math.ceil((d.getDay() + 1 + num) / 7)}`;
}

// ================= FINALIZAR SESION =================

async function finalizarSesion(userId, data) {

if (!activeUsers.has(userId)) {
        return;
    }

    const end = Date.now();

    const diff =
        Math.floor(
            (end - data.start) / 1000
        );

    db.run(
        `INSERT INTO sessions
        (user_id, duration, created_at)
        VALUES (?, ?, ?)`,

        [
            userId,
            diff,
            Date.now()
        ]
    );
    activeUsers.delete(userId);

    db.run(
        `DELETE FROM active_sessions WHERE user_id=?`,
        [userId]
    );

    const week = getWeek();

db.run(`
    INSERT INTO weekly_time VALUES (?, ?, ?)
    ON CONFLICT(user_id, week)
    DO UPDATE SET total_time = total_time + ?
`,
[userId, week, diff, diff],
() => {

    db.run(
        `INSERT INTO session_logs
        (user_id, start_time, end_time, duration)
        VALUES (?, ?, ?, ?)`,
        [
            userId,
            data.start,
            end,
            diff
        ]
    );

    db.get(
        `SELECT * FROM weekly_time
        WHERE user_id=? AND week=?`,
        [userId, week],
        async (err, row) => {

            const total =
                row ? row.total_time : diff;

            const channel =
                await client.channels.fetch(
                    LOG_CHANNEL_ID
                );

            const embed =
                new EmbedBuilder()
                    .setColor(0x00bfff)
                    .setTitle('📊 Sesión Finalizada')
                    .addFields(
                        {
                            name: '👤 Usuario',
                            value: `<@${userId}>`,
                            inline: true
                        },
                        {
                            name: '🟢 Entrada',
                            value: formatHour(data.start),
                            inline: true
                        },
                        {
                            name: '🔴 Salida',
                            value: formatHour(end),
                            inline: true
                        },
                        {
                            name: '⏱️ Duración',
                            value: formatTime(diff)
                        },
                        {
                            name: '📊 Total Semanal',
                            value: formatTime(total)
                        }
                    );

            await channel.send({
                embeds: [embed]
            });
        }
    );
});
}

// ================= VOICE =================

client.on('voiceStateUpdate', async (oldState, newState) => {

    const userId = newState.id;

    // ENTRADA VOICE
    if (
        oldState.channelId !== VOICE_CHANNEL_ID &&
        newState.channelId === VOICE_CHANNEL_ID
    ) {

        if (!activeUsers.has(userId)) {

            const now = Date.now();

            const last = reminderCooldown.get(userId) || 0;

            if (now - last > 120000) {

                reminderCooldown.set(userId, now);

                try {

                    const user = await client.users.fetch(userId);

                    await user.send(
`👋 Hola!

Ingresaste al canal de Voice "En Servicio" en el Discord de MEDICA URUGUAYA.

Si estás en servicio IC o vas a entrar, no olvides activar el bot de horas en el canal FICHAJE⏱️

Si no lo haces,no contarán tus horas de trabajo.

Gracias por ser parte del SAME-MEDICA URUGUAYA 🙌`
                    );

                } catch {}
            }
        }
    }

    // SALIDA VOICE
    if (
        oldState.channelId === VOICE_CHANNEL_ID &&
        newState.channelId !== VOICE_CHANNEL_ID
    ) {

        if (!activeUsers.has(userId)) return;

        const data = sessionTime.get(userId);

        if (!data) return;

        await finalizarSesion(userId, data);

try {

    const user =
        await client.users.fetch(
            userId
        );

    await user.send(
        '⏹️ Tu conteo fue detenido automáticamente al salir del canal de voz.'
    );

} catch {}

// quitar rol al salir del voice

try {

    const guild = await client.guilds.fetch(GUILD_ID);

    const member = await guild.members.fetch(userId);

await member.roles.remove(
    SERVICE_ROLE_ID
);

} catch (err) {

    console.log(err);

   }

// ================= PANEL =================

async function enviarPanel() {

    try {

        const ch =
            await client.channels.fetch(
                PANEL_CHANNEL_ID
            );

        const row =
            new ActionRowBuilder()
                .addComponents(

                 
                    new ButtonBuilder()
                        .setCustomId(
                            'iniciar'
                        )
                        .setLabel(
                            '▶️ Iniciar'
                        )
                        .setStyle(
                            ButtonStyle.Primary
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            'detener'
                        )
                        .setLabel(
                            '⏹️ Detener'
                        )
                        .setStyle(
                            ButtonStyle.Danger
                        ),

                    new ButtonBuilder()
                        .setCustomId(
                            'ranking'
                        )
                        .setLabel(
                            '📅 Ranking'
                        )
                        .setStyle(
                            ButtonStyle.Success
                        )
                );

        await ch.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle('📊 Panel de Fichaje')
                    .setDescription('Control horas de trabajo')
            ],
            components: [row]
        });

const adminCh = await client.channels.fetch(ADMIN_PANEL_CHANNEL_ID);

const adminEmbed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle('⚙️ PANEL ADMINISTRATIVO')
    .setDescription(
`🏥 SAME - MEDICA URUGUAYA
By Mathi Uruwayo- DG

━━━━━━━━━━━━━━━━━━
SANCIONES
⚠️ Warn
🚨 Strike
📋 Historial

🔐 Rango requerido:
GESTION DE PERSONAL
DIRECTOR
━━━━━━━━━━━━━━━━━━
ADMINISTRACION
🎁 Rewards (crear-elegibles)
🗑️ Remove Warn
🗑️ Remove Strike

🔐 Rango requerido:
DIRECTOR

━━━━━━━━━━━━━━━━━━
GESTION DE POSTULACIONES
✅ Aprobar postulantes

🔐 Rango requerido:
INSTRUCTOR
DIRECTOR
━━━━━━━━━━━━━━━━━━`
)


// ================= REWARDS =================

const rewardsRow = new ActionRowBuilder()
    .addComponents(

        new ButtonBuilder()
            .setCustomId('crear_reward')
            .setEmoji('🎁')
            .setLabel('Crear')
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId('ver_rewards')
            .setEmoji('📋')
            .setLabel('Rewards')
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId('ver_elegibles')
            .setEmoji('🏆')
            .setLabel('Elegibles')
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId('eliminar_reward')
            .setEmoji('❌')
            .setLabel('Eliminar')
            .setStyle(ButtonStyle.Danger)
    );


// ================= MODERACION =================

const modRow = new ActionRowBuilder()
    .addComponents(

        new ButtonBuilder()
            .setCustomId('add_warn')
            .setEmoji('⚠️')
            .setLabel('Warn')
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('add_strike')
            .setEmoji('🚨')
            .setLabel('Strike')
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId('view_sanctions')
            .setEmoji('📋')
            .setLabel('Historial')
            .setStyle(ButtonStyle.Primary)
    );


// ================= ADMIN =================

const adminRow = new ActionRowBuilder()
    .addComponents(

        new ButtonBuilder()
            .setCustomId('aprobar_postulante')
            .setEmoji('✅')
            .setLabel('Aprobar')
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId('despedir_postulante')
            .setEmoji('❌')
            .setLabel('Despedir')
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId('remove_warn')
            .setEmoji('🗑️')
            .setLabel('Remove Warn')
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('remove_strike')
            .setEmoji('🗑️')
            .setLabel('Remove Strike')
            .setStyle(ButtonStyle.Secondary)
    );

await adminCh.send({
    embeds: [adminEmbed],
    components: [
        rewardsRow,
        modRow,
        adminRow
    ]
});

    } catch (err) {

        console.log('❌ ERROR PANEL:');
        console.log(err);
    }
}

async function enviarPanelPostulacion() {

    try {

        const ch =
            await client.channels.fetch(
                PANEL_POSTULACIONES_ID
            );

        const row =
            new ActionRowBuilder()
                .addComponents(

                    new ButtonBuilder()
                        .setCustomId(
                            'postularme'
                        )
                        .setLabel(
                            '📝 Postularme'
                        )
                        .setStyle(
                            ButtonStyle.Primary
                        )
                );

        const embed =
            new EmbedBuilder()
                .setColor(0x00bfff)
                .setTitle(
                    '📋 Postulaciones SAME'
                )
                .setDescription(
`Bienvenido a MEDICA URUGUAYA.

Si deseas formar parte del equipo:

🩺 Completa la postulación
📚 Espera revisión de los Instructores
✅ Recibirás respuesta automática`
                )
                .setFooter({
                    text:
                        'MEDICA URUGUAYA'
                });

        await ch.send({
            embeds: [embed],
            components: [row]
        });

    } catch (err) {

        console.log(
            '❌ Error enviando panel postulaciones:',
            err
        );
    }
}


// ================= INTERACCIONES =================

client.on('interactionCreate', async i => {

    if (
        !i.isButton() &&
        !i.isModalSubmit() &&
        !i.isStringSelectMenu()
    ) return;

    const userId = i.user.id;
if (
    i.isButton() &&
    i.customId === 'postularme'
) {

    const modal =
        new ModalBuilder()
            .setCustomId(
                'modal_postulacion'
            )
            .setTitle(
                '📋 Postulación'
            );

    const nombre =
        new TextInputBuilder()
            .setCustomId(
                'nombre_ic'
            )
            .setLabel(
                'Nombre IC'
            )
            .setStyle(
                TextInputStyle.Short
            );

    const edad =
        new TextInputBuilder()
            .setCustomId(
                'edad'
            )
            .setLabel(
                'Edad Real'
            )
            .setStyle(
                TextInputStyle.Short
            );

    const experiencia =
        new TextInputBuilder()
            .setCustomId(
                'experiencia'
            )
            .setLabel(
                'Ya tienes experiencia como SAME?'
            )
            .setStyle(
                TextInputStyle.Paragraph
            );

    const horarios =
        new TextInputBuilder()
            .setCustomId(
                'horarios'
            )
            .setLabel(
                'Horarios disponibles para estar en servicio?'
            )
            .setStyle(
                TextInputStyle.Short
            );

    const motivo =
        new TextInputBuilder()
            .setCustomId(
                'motivo'
            )
            .setLabel(
                '¿Por qué quieres entrar a la faccion?'
            )
            .setStyle(
                TextInputStyle.Paragraph
            );

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(nombre),

        new ActionRowBuilder()
            .addComponents(edad),

        new ActionRowBuilder()
            .addComponents(experiencia),

        new ActionRowBuilder()
            .addComponents(horarios),

        new ActionRowBuilder()
            .addComponents(motivo)
    );

    return i.showModal(modal);
}

if (
    i.isModalSubmit() &&
    i.customId === 'modal_postulacion'
) {

    await i.deferReply({
        flags: 64
    });

    const nombre =
        i.fields.getTextInputValue(
            'nombre_ic'
        );

    const edad =
        i.fields.getTextInputValue(
            'edad'
        );

    const experiencia =
        i.fields.getTextInputValue(
            'experiencia'
        );

    const horarios =
        i.fields.getTextInputValue(
            'horarios'
        );

    const motivo =
        i.fields.getTextInputValue(
            'motivo'
        );

    const embed =
        new EmbedBuilder()
            .setColor(0x00bfff)
            .setTitle(
                '📋 Nueva Postulación'
            )
            .setDescription(
`👤 Usuario:
<@${i.user.id}>

🩺 Nombre IC:
${nombre}

🎂 Edad:
${edad}

📚 Experiencia:
${experiencia}

🕓 Horarios:
${horarios}

📝 Motivo:
${motivo}`
            )
            .setFooter({
                text:
                    'MEDICA URUGUAYA'
            })
            .setTimestamp();

    const aprobar =
        new ButtonBuilder()
            .setCustomId(
                `aprobar_${i.user.id}`
            )
            .setLabel(
                '✅ Aprobar'
            )
            .setStyle(
                ButtonStyle.Success
            );

    const rechazar =
        new ButtonBuilder()
            .setCustomId(
                `rechazar_${i.user.id}`
            )
            .setLabel(
                '❌ Rechazar'
            )
            .setStyle(
                ButtonStyle.Danger
            );

    const row =
        new ActionRowBuilder()
            .addComponents(
                aprobar,
                rechazar
            );

    const channel =
        await client.channels.fetch(
            POSTULACIONES_CHANNEL_ID
        );

    await channel.send({
        embeds: [embed],
        components: [row]
    });

    await i.editReply({
        content:
            '✅ Tu postulación fue enviada correctamente'
    });
}
if (
    i.isButton() &&
    i.customId.startsWith('aprobar_')
) {

    await i.deferReply({
        flags: 64
    });

    const userId =
        i.customId.split('_')[1];

    try {

        const guild =
            await client.guilds.fetch(
                GUILD_ID
            );

        const member =
            await guild.members.fetch(
                userId
            );

        await member.roles.add(
            POSTULANTE_ROLE_ID
        );

        const channel =
            await client.channels.fetch(
                APROBADOS_CHANNEL_ID
            );

        await channel.send(
`🎉 Felicitaciones <@${userId}>, fuiste aceptado en MEDICA URUGUAYA. ¡Bienvenido al equipo!🩺`
        );

        await i.editReply({
            content:
                '✅ Postulación aprobada'
        });

await i.message.delete();

    } catch (err) {

        console.log(err);

        await i.editReply({
            content:
                '❌ Error aprobando postulante'
        });
    }
}

if (
    i.isButton() &&
    i.customId.startsWith('rechazar_')
) {

    await i.deferReply({
        flags: 64
    });

    const userId =
        i.customId.split('_')[1];

    await i.editReply({
        content:
            `❌ Postulación rechazada para <@${userId}>`
    });
}

// ================= VER ELEGIBLES =================
if (i.isButton() && i.customId === 'ver_elegibles') {

    await i.deferReply({ flags: 64 });

    db.all(
        `SELECT * FROM rewards WHERE active=1`,
        [],

        async (err, rewards) => {

            if (!rewards.length) {

                return i.editReply({
                    content:
                        '❌ No hay rewards activos'
                });
            }

            const options = [];

            const guild =
                await client.guilds.fetch(
                    GUILD_ID
                );

            for (const reward of rewards) {

                const sessions =
                    await new Promise(
                        (resolve, reject) => {

                            db.all(
                                `SELECT * FROM sessions
                                WHERE created_at >= ?`,
                                [reward.created_at],

                                (err, rows) => {

                                    if (err)
                                        reject(err);

                                    else
                                        resolve(rows);
                                }
                            );
                        }
                    );

                const totals = {};

                sessions.forEach(session => {

                    if (
                        !totals[
                            session.user_id
                        ]
                    ) {

                        totals[
                            session.user_id
                        ] = 0;
                    }

                    totals[
                        session.user_id
                    ] += session.duration;
                });

                for (const userId of Object.keys(totals)) {

                    const hours =
                        Math.floor(
                            totals[userId]
                            / 3600
                        );

                    if (
                        hours >=
                        reward.required_hours
                    ) {

                        try {

                            const member =
                                await guild.members.fetch(
                                    userId
                                );

                            options.push({
                                label:
                                    `${reward.name} - ${hours}h`,

                                description:
                                    member.displayName,

                                value:
                                    `${userId}|${reward.name}`
                            });

                        } catch {

                            options.push({
                                label:
                                    `${reward.name} - ${hours}h`,

                                description:
                                    `Usuario desconocido`,

                                value:
                                    `${userId}|${reward.name}`
                            });
                        }
                    }
                }
            }

            if (!options.length) {

                return i.editReply({
                    content:
                        '❌ No hay usuarios elegibles'
                });
            }

            const menu =
                new StringSelectMenuBuilder()
                    .setCustomId(
                        'select_entregar_reward'
                    )
                    .setPlaceholder(
                        'Seleccionar ganador'
                    )
                    .addOptions(
                        options.slice(0, 25)
                    );

            const row =
                new ActionRowBuilder()
                    .addComponents(menu);

            await i.editReply({
                content:
                    '🏆 Usuarios elegibles',
                components: [row]
            });
        }
    );
}
// ================= ADD WARN =================

if (i.isButton() && i.customId === 'add_warn') {

    if (!i.member.roles.cache.has(MOD_ROLE_ID)) {

        return i.reply({
            content: '❌ No tienes permisos',
            flags: 64
        });
    }

    const modal = new ModalBuilder()
        .setCustomId('modal_warn')
        .setTitle('⚠️ Nueva Advertencia');

    const usuario = new TextInputBuilder()
        .setCustomId('warn_user')
        .setLabel('ID del usuario')
        .setStyle(TextInputStyle.Short);

    const motivo = new TextInputBuilder()
        .setCustomId('warn_reason')
        .setLabel('Motivo')
        .setStyle(TextInputStyle.Paragraph);

    modal.addComponents(
        new ActionRowBuilder().addComponents(usuario),
        new ActionRowBuilder().addComponents(motivo)
    );

    return i.showModal(modal);
}

// ================= GUARDAR WARN =================

if (i.isModalSubmit() && i.customId === 'modal_warn') {

    const target = i.fields.getTextInputValue('warn_user');

    const reason = i.fields.getTextInputValue('warn_reason');

    // ================= CONTAR WARNS =================

    db.all(
        `SELECT * FROM sanctions
        WHERE user_id=? AND type='warn'`,
        [target],
        async (err, warnRows) => {

            const totalWarns = warnRows.length;

            // ================= LIMITE =================

            if (totalWarns >= 3) {

                return i.reply({
                    content:
                        '❌ El usuario ya tiene 3 advertencias pendientes.',
                    flags: 64
                });
            }

            // ================= AGREGAR WARN =================

db.run(
    `INSERT INTO admin_history
    (user_id, action, admin_id, date)
    VALUES (?, ?, ?, ?)`,
    [
        target,
        `Warn: ${reason}`,
        i.user.id,
        new Date().toLocaleString(
    'es-UY',
    {
        timeZone:
            'America/Montevideo'
    }
)
    ]
);
                    db.all(
                        `SELECT * FROM sanctions
                        WHERE user_id=? AND type='warn'`,
                        [target],
                        async (err, updatedWarns) => {

                            const newWarnCount =
                                updatedWarns.length;

                            try {

                                const publicChannel =
                                    await client.channels.fetch(
                                        PUBLIC_SANCTION_CHANNEL_ID
                                    );

                                const embed = new EmbedBuilder()
                                    .setColor(0xffcc00)
                                    .setTitle('⚠️ Advertencia Registrada')
                                    .setDescription(
`👤 Usuario:
<@${target}>

📌 Motivo:
${reason}

⚠️ Advertencias:
${newWarnCount}/3`
                                    )
                                    .setFooter({
                                        text:
                                            `Aplicado por ${i.user.tag}`
                                    })
                                    .setTimestamp();

                                await publicChannel.send({
                                    embeds: [embed]
                                });

                            } catch (e) {

                                console.log(
                                    '❌ Error enviando warn:',
                                    e
                                );
                            }

                            // ================= AUTO STRIKE =================

                            if (newWarnCount >= 3) {

                                // borrar warns

                                db.run(
                                    `DELETE FROM sanctions
                                    WHERE user_id=? AND type='warn'`,
                                    [target]
                                );

                                // agregar strike

                                db.run(
                                    `INSERT INTO sanctions
                                    (user_id, type, reason, admin_id, date)
                                    VALUES (?, ?, ?, ?, ?)`,
                                    [
                                        target,
                                        'strike',
                                        'AutoStrike por 3 advertencias',
                                        i.user.id,
                                        new Date().toLocaleString(
    'es-UY',
    {
        timeZone:
            'America/Montevideo'
    }
)
                                    ]
                                );

                                try {

                                    const publicChannel =
                                        await client.channels.fetch(
                                            PUBLIC_SANCTION_CHANNEL_ID
                                        );

                                    const strikeEmbed =
                                        new EmbedBuilder()
                                            .setColor(0xff0000)
                                            .setTitle(
                                                '🚨 Auto Strike'
                                            )
                                            .setDescription(
`<@${target}> acumuló 3 advertencias.

🚨 Se aplicó automáticamente 1 strike.`
                                            )
                                            .setTimestamp();

                                    await publicChannel.send({
                                        content:
                                            `<@&${ADMIN_ROLE_ID}>`,
                                        embeds: [strikeEmbed]
                                    });

                                } catch (e) {

                                    console.log(
                                        '❌ Error autostrike:',
                                        e
                                    );
                                }
                            }

                            return i.reply({
                                content:
                                    `✅ Advertencia agregada (${newWarnCount}/3)`,
                                flags: 64
                            });
                        }
                    );
                }
            );
}

// ================= ADD STRIKE =================

if (i.isButton() && i.customId === 'add_strike') {

    if (!i.member.roles.cache.has(MOD_ROLE_ID)) {

        return i.reply({
            content: '❌ No tienes permisos',
            flags: 64
        });
    }

    const modal = new ModalBuilder()
        .setCustomId('modal_strike')
        .setTitle('🚨 Nuevo Strike');

    const usuario = new TextInputBuilder()
        .setCustomId('strike_user')
        .setLabel('ID del usuario')
        .setStyle(TextInputStyle.Short);

    const motivo = new TextInputBuilder()
        .setCustomId('strike_reason')
        .setLabel('Motivo')
        .setStyle(TextInputStyle.Paragraph);

    modal.addComponents(
        new ActionRowBuilder().addComponents(usuario),
        new ActionRowBuilder().addComponents(motivo)
    );

    return i.showModal(modal);
}

// ================= GUARDAR STRIKE =================

if (i.isModalSubmit() && i.customId === 'modal_strike') {

await i.deferReply({ flags: 64 });

    const target = i.fields.getTextInputValue('strike_user');

    const reason = i.fields.getTextInputValue('strike_reason');

    db.run(
        `INSERT INTO sanctions
        (user_id, type, reason, admin_id, date)
        VALUES (?, ?, ?, ?, ?)`,
        [
            target,
            'strike',
            reason,
            i.user.id,
            new Date().toLocaleString(
    'es-UY',
    {
        timeZone:
            'America/Montevideo'
    }
)
        ],
        () => {

            db.all(
                `SELECT * FROM sanctions
                WHERE user_id=? AND type='strike'`,
                [target],
                async (err, rows) => {

                    const totalStrikes = rows.length;

                    try {

                        const publicChannel =
                            await client.channels.fetch(
                                PUBLIC_SANCTION_CHANNEL_ID
                            );

                        const embed = new EmbedBuilder()
                            .setColor(0xff0000)
                            .setTitle('🚨 Strike Registrado')
                            .setDescription(
`👤 Usuario:
<@${target}>

📌 Motivo:
${reason}

🚨 Strikes acumulados:
${totalStrikes}/3`
                            )
                            .setFooter({
                                text: `Aplicado por ${i.user.tag}`
                            })
                            .setTimestamp();

                        await publicChannel.send({
                            embeds: [embed]
                        });

                        // ================= AUTO ALERTA =================

                        if (totalStrikes >= 3) {

                            const alertEmbed = new EmbedBuilder()
                                .setColor(0x8b0000)
                                .setTitle('⚠️ ALERTA AUTOMÁTICA')
                                .setDescription(
`<@${target}> alcanzó el límite de strikes.

🚨 Total:
${totalStrikes}/3`
                                )
                                .setTimestamp();

                            await publicChannel.send({
                                content: `<@&${ADMIN_ROLE_ID}>`,
                                embeds: [alertEmbed]
                            });
                        }

                    } catch (e) {

                        console.log(
                            '❌ Error enviando strike:',
                            e
                        );
                    }

                    await i.editReply({
                        content:
                            `✅ Strike agregado (${totalStrikes}/3)`,
                        flags: 64
                    });
                }
            );
        }
    );
}
if (
    i.isButton() &&
    i.customId === 'aprobar_postulante'
) {

    if (
        !i.member.roles.cache.has(
            ADMIN_ROLE_ID
        ) &&
        !i.member.roles.cache.has(
            POSTULACIONES_ROLE_ID
        )
    ) {

        return i.reply({
            content:
                '❌ No tienes permisos',
            flags: 64
        });
    }

    try {

        const modal =
            new ModalBuilder()
                .setCustomId(
                    'modal_aprobar_postulante'
                )
                .setTitle(
                    '✅ Aprobar postulante'
                );

        const usuario =
            new TextInputBuilder()
                .setCustomId(
                    'postulante_id'
                )
                .setLabel(
                    'ID del postulante'
                )
                .setStyle(
                    TextInputStyle.Short
                );

        modal.addComponents(
            new ActionRowBuilder()
                .addComponents(usuario)
        );

        await i.showModal(modal);

    } catch (err) {

        console.log(err);

        if (!i.replied) {

            await i.reply({
                content:
                    '❌ Error abriendo modal',
                flags: 64
            });
        }
    }
}
if (
    i.isModalSubmit() &&
    i.customId === 'modal_aprobar_postulante'
) {

    await i.deferReply({
        flags: 64
    });

    const userId =
        i.fields.getTextInputValue(
            'postulante_id'
        );
    try {

        const channel =
            await client.channels.fetch(
                APROBADOS_CHANNEL_ID
            );
const guild =
    await client.guilds.fetch(
        GUILD_ID
    );

const member =
    await guild.members.fetch(
        userId
    );

await member.roles.add(
    POSTULANTE_ROLE_ID
);

db.run(
    `INSERT INTO admin_history
    (user_id, action, admin_id, date)
    VALUES (?, ?, ?, ?)`,
    [
        userId,
        'Aprobado',
        i.user.id,
        new Date().toLocaleString(
    'es-UY',
    {
        timeZone:
            'America/Montevideo'
    }
)
    ],
    (err) => {

        if (err) {

            console.log(err);

        } else {

            console.log('✅ Historial guardado');
        }
    }
);
        await channel.send(
`🎉 Felicitaciones <@${userId}>, fuiste aceptado en MEDICA URUGUAYA. ¡Bienvenido al equipo! 🩺`
        );

        await i.editReply({
            content:
                '✅ Postulante aprobado',
            flags: 64
        });

    } catch (err) {

        console.log(err);

        await i.editReply({
            content:
                '❌ Error enviando anuncio',
            flags: 64
        });
    }
}

// ================= VER HISTORIAL =================

if (i.isButton() && i.customId === 'view_sanctions') {

    if (!i.member.roles.cache.has(MOD_ROLE_ID)) {

        return i.reply({
            content: '❌ No tienes permisos',
            flags: 64
        });
    }

    await i.deferReply({ flags: 64 });

    db.all(
    `SELECT * FROM sanctions
    ORDER BY date DESC`,
    [],
    async (err, rows) => {

        if (!rows || rows.length === 0) {

            return i.editReply({
    content:
        '❌ No hay sanciones registradas'
});
        }

        const users = {};

        rows.forEach(r => {

            if (!users[r.user_id]) {

                users[r.user_id] = {
                    warns: 0,
                    strikes: 0,
                    lastReason: r.reason,
                    lastDate: r.date
                };
            }

            if (r.type === 'warn') {

                users[r.user_id].warns++;

            } else if (r.type === 'strike') {

                users[r.user_id].strikes++;
            }
        });

        let txt =
`📋 HISTORIAL DISCIPLINARIO

`;

        Object.keys(users).forEach(userId => {

            const u = users[userId];

            txt +=
`👤 <@${userId}>

⚠️ Advertencias: ${u.warns}
❌ Strikes: ${u.strikes}

📌 Última sanción:
${u.lastReason}

📅 Última fecha:
${u.lastDate}

─────────────────

`;
        });

        await i.editReply({
            content: txt.slice(0, 1900),
            flags: 64
        });
    }
);
}
// ================= REMOVE WARN =================

if (i.isButton() && i.customId === 'remove_warn') {

    if (!i.member.roles.cache.has(ADMIN_ROLE_ID)) {

        return i.reply({
            content: '❌ No tienes permisos',
            flags: 64
        });
    }

    await i.deferReply({ flags: 64 });

    db.all(
        `SELECT * FROM sanctions
        WHERE type='warn'
        ORDER BY id DESC
        LIMIT 25`,
        [],
        async (err, rows) => {

            if (!rows || rows.length === 0) {

                return i.editReply({
                    content: '❌ No hay advertencias'
                });
            }

            const menu = new StringSelectMenuBuilder()
                .setCustomId('select_remove_warn')
                .setPlaceholder('Seleccionar advertencia');

            for (const r of rows) {

    let username = r.user_id;

    try {

        const user =
            await client.users.fetch(r.user_id);

        username = user.username;

    } catch {}

    menu.addOptions({
        label: username,
        description: r.reason.slice(0, 80),
        value: String(r.id)
    });
}

            const row = new ActionRowBuilder()
                .addComponents(menu);

            await i.editReply({
                content: '🗑️ Selecciona advertencia',
                components: [row]
            });
        }
    );
}

// ================= REMOVE STRIKE =================

if (i.isButton() && i.customId === 'remove_strike') {

    if (!i.member.roles.cache.has(ADMIN_ROLE_ID)) {

        return i.reply({
            content: '❌ No tienes permisos',
            flags: 64
        });
    }

    await i.deferReply({ flags: 64 });

    db.all(
        `SELECT * FROM sanctions
        WHERE type='strike'
        ORDER BY id DESC
        LIMIT 25`,
        [],
        async (err, rows) => {

            if (!rows || rows.length === 0) {

                return i.editReply({
                    content: '❌ No hay strikes'
                });
            }

            const menu = new StringSelectMenuBuilder()
                .setCustomId('select_remove_strike')
                .setPlaceholder('Seleccionar strike');

           for (const r of rows) {

    let username = r.user_id;

    try {

        const user =
            await client.users.fetch(r.user_id);

        username = user.username;

    } catch {}

    menu.addOptions({
        label: username,
        description: r.reason.slice(0, 80),
        value: String(r.id)
    });
}

            const row = new ActionRowBuilder()
                .addComponents(menu);

            await i.editReply({
                content: '🗑️ Selecciona strike',
                components: [row]
            });
        }
    );
}

// ================= SELECT MENU =================

if (i.isStringSelectMenu()) {

    if (!i.member.roles.cache.has(ADMIN_ROLE_ID)) {

        return i.reply({
            content: '❌ No tienes permisos',
            flags: 64
        });
    }

    // eliminar warn
    if (i.customId === 'select_remove_warn') {

        const id = i.values[0];

        db.run(
            `DELETE FROM sanctions WHERE id=?`,
            [id],
            async () => {

                await i.reply({
                    content: '✅ Advertencia eliminada',
                    flags: 64
                });
            }
        );
    }

    // eliminar strike
    if (i.customId === 'select_remove_strike') {

        const id = i.values[0];

        db.run(
            `DELETE FROM sanctions WHERE id=?`,
            [id],
            async () => {

                await i.reply({
                    content: '✅ Strike eliminado',
                    flags: 64
                });
            }
        );
    }
}

    // ================= INICIAR =================

    if (i.isButton() && i.customId === 'iniciar') {

        const member = i.member;

        if (
            !member.voice.channel ||
            member.voice.channel.id !== VOICE_CHANNEL_ID
        ) {

            return i.reply({
                content: '❌ Debes estar en el voice "en servicio"',
                flags: 64
            });
        }

        if (activeUsers.has(userId)) {

            return i.reply({
                content: '⚠️ Ya estás contando horas',
                flags: 64
            });
        }

        const start = Date.now();

        activeUsers.add(userId);

        sessionTime.set(userId, {
            start
        });

        db.run(
            `INSERT OR REPLACE INTO active_sessions VALUES (?,?,?)`,
            [userId, start, 'voice']
        );

        // agregar rol servicio
        try {

            await i.member.roles.add(SERVICE_ROLE_ID);

        } catch (err) {

            console.log('❌ Error agregando rol:', err);
        }

        return i.reply({
            content: '✅ Conteo iniciado',
            flags: 64
        });
    }

    // ================= DETENER =================

    if (i.isButton() && i.customId === 'detener') {

        const data = sessionTime.get(userId);

        if (!data) {

            return i.reply({
                content: '❌ No estás contando horas',
                flags: 64
            });
        }

        await finalizarSesion(userId, data);

        try {

            await i.member.roles.remove(SERVICE_ROLE_ID);

        } catch (err) {

            console.log('❌ Error quitando rol:', err);
        }

        return i.reply({
            content: '⏹️ Conteo detenido',
            flags: 64
        });
    }

    // ================= RANKING =================

    if (i.isButton() && i.customId === 'ranking') {

        const week = getWeek();

        db.all(
            `SELECT * FROM weekly_time
            WHERE week=?
            ORDER BY total_time DESC
            LIMIT 10`,
            [week],
            async (err, rows) => {

                let txt = '';

                rows.forEach((r, index) => {

                    txt += `${index + 1}. <@${r.user_id}> — ${formatTime(r.total_time)}\n`;
                });

                await i.reply({
                    content: txt || '❌ Sin datos',
                    flags: 64
                });
            }
        );
    }

    // ================= CREAR REWARD =================

    if (i.isButton() && i.customId === 'crear_reward') {

        if (!i.member.roles.cache.has(ADMIN_ROLE_ID)) {

            return i.reply({
                content: '❌ No tienes permisos',
                flags: 64
            });
        }

        const modal = new ModalBuilder()
            .setCustomId('modal_reward')
            .setTitle('🎁 Crear recompensa');

        const nombre = new TextInputBuilder()
            .setCustomId('reward_name')
            .setLabel('Nombre')
            .setStyle(TextInputStyle.Short);

        const premio = new TextInputBuilder()
            .setCustomId('reward_prize')
            .setLabel('Premio')
            .setStyle(TextInputStyle.Short);

        const horas = new TextInputBuilder()
            .setCustomId('reward_hours')
            .setLabel('Horas requeridas')
            .setStyle(TextInputStyle.Short);

        const descripcion = new TextInputBuilder()
            .setCustomId('reward_desc')
            .setLabel('Descripción')
            .setStyle(TextInputStyle.Paragraph);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nombre),
            new ActionRowBuilder().addComponents(premio),
            new ActionRowBuilder().addComponents(horas),
            new ActionRowBuilder().addComponents(descripcion)
        );

        return i.showModal(modal);
    }
if (
    i.isButton() &&
    i.customId === 'despedir_postulante'
) {

    if (!i.member.roles.cache.has(ADMIN_ROLE_ID)) {

        return i.reply({
            content: '❌ No tienes permisos',
            flags: 64
        });
    }

    const modal = new ModalBuilder()
        .setCustomId('modal_despedir_postulante')
        .setTitle('❌ Despedir integrante');

    const usuario = new TextInputBuilder()
        .setCustomId('despedido_id')
        .setLabel('ID del integrante')
        .setStyle(TextInputStyle.Short);

    modal.addComponents(
        new ActionRowBuilder()
            .addComponents(usuario)
    );

    return i.showModal(modal);
}
if (
    i.isModalSubmit() &&
    i.customId === 'modal_despedir_postulante'
) {

    await i.deferReply({
        flags: 64
    });

    const userId =
        i.fields.getTextInputValue(
            'despedido_id'
        );

    try {

        const guild =
            await client.guilds.fetch(
                GUILD_ID
            );

        const member =
            await guild.members.fetch(
                userId
            );

        await member.roles.remove(
            SERVICE_ROLE_ID
        );

        await member.roles.add(
            DESPEDIDO_ROLE_ID
        );

        await i.editReply({
            content:
                '✅ Integrante despedido'
        });

    } catch (err) {

        console.log(err);

        await i.editReply({
            content:
                '❌ Algo ha fallado'
        });
    }
}
 // ================= GUARDAR REWARD =================

if (
    i.isModalSubmit() &&
    i.customId === 'modal_reward'
) {

    const name =
        i.fields.getTextInputValue(
            'reward_name'
        );

    const reward =
        i.fields.getTextInputValue(
            'reward_prize'
        );

    const hours = parseInt(
        i.fields.getTextInputValue(
            'reward_hours'
        )
    );

    const desc =
        i.fields.getTextInputValue(
            'reward_desc'
        );

    db.run(
        `INSERT INTO rewards
        (name, reward, required_hours, description, created_at, active)
        VALUES (?, ?, ?, ?, ?, 1)`,

        [
            name,
            reward,
            hours,
            desc,
            Date.now()
        ],

        async (err) => {

            if (err) {

                console.log(err);

                return i.reply({
                    content:
                        '❌ Error creando reward',
                    flags: 64
                });
            }

            try {

                const rewardChannel =
                    await client.channels.fetch(
                        REWARD_CHANNEL_ID
                    );

                const embed =
                    new EmbedBuilder()
                        .setColor(0x00bfff)
                        .setTitle(
                            '🎁 Nueva Recompensa Disponible'
                        )
                        .setDescription(
`🏅 **${name}**

🎁 Premio:
${reward}

⏱️ Horas requeridas:
${hours}h

📝 Descripción:
${desc}

⚠️ Todos deben reiniciar el conteo para participar correctamente del reward.`
                        )
                        .setFooter({
                            text:
                                'SAME - MEDICA URUGUAYA'
                        })
                        .setTimestamp();

                await rewardChannel.send({
                    content:
                        `<@&${REWARD_ROLE_ID}>`,
                    embeds: [embed]
                });

            } catch (e) {

                console.log(
                    '❌ Error enviando reward:',
                    e
                );
            }

            return i.reply({
                content:
                    `✅ Recompensa creada: ${name}`,
                flags: 64
            });
        }
    );
}

    // ================= VER REWARDS =================

    if (i.isButton() && i.customId === 'ver_rewards') {

        await i.deferReply({ flags: 64 });

        db.all(
            `SELECT * FROM rewards`,
            [],
            async (err, rows) => {

                if (!rows || rows.length === 0) {

                    return i.editReply({
                        content: '❌ No hay recompensas'
                    });
                }

                let txt = '🎁 Recompensas activas\n\n';

                rows.forEach(r => {

                    txt +=
`🏅 ${r.name}
⏱️ ${r.required_hours}h
🎁 ${r.reward}

📝 ${r.description}

`;
                });

                await i.editReply({
                    content: txt
                });
            }
        );
    }


// ================= VER GANADORES =================

if (i.isButton() && i.customId === 'ver_ganadores') {

    await i.deferReply({ flags: 64 });

    db.all(
        `SELECT * FROM reward_winners
        ORDER BY id DESC
        LIMIT 20`,
        [],
        async (err, rows) => {

            if (!rows || rows.length === 0) {

                return i.editReply({
                    content: '❌ No hay ganadores registrados'
                });
            }

            let txt = '🏆 Últimos ganadores\n\n';

            rows.forEach(r => {

                txt +=
`👤 <@${r.user_id}>
🎁 ${r.reward_name}
📅 ${r.date}

`;
            });

            await i.editReply({
                content: txt
            });
        }
    );
}

    // ================= ELIMINAR REWARD =================

    if (i.isButton() && i.customId === 'eliminar_reward') {

        if (!i.member.roles.cache.has(ADMIN_ROLE_ID)) {

            return i.reply({
                content: '❌ No tienes permisos',
                flags: 64
            });
        }

        await i.deferReply({ flags: 64 });

        db.all(
            `SELECT * FROM rewards`,
            [],
            async (err, rows) => {

                if (!rows || rows.length === 0) {

                    return i.editReply({
                        content: '❌ No hay recompensas'
                    });
                }

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('select_delete_reward')
                    .setPlaceholder('Seleccionar recompensa');

                rows.forEach(r => {

                    menu.addOptions({
                        label: r.name,
                        description: `${r.required_hours}h`,
                        value: String(r.id)
                    });
                });

                const row = new ActionRowBuilder()
                    .addComponents(menu);

                await i.editReply({
                    content: '❌ Selecciona recompensa a eliminar',
                    components: [row]
                });
            }
        );
    }
// ================= ENVIAR GANADORES =================

if (i.isButton() && i.customId === 'enviar_ganadores') {

    if (!i.member.roles.cache.has(ADMIN_ROLE_ID)) {

        return i.reply({
            content: '❌ No tienes permisos',
            flags: 64
        });
    }

    await i.deferReply({ flags: 64 });

    db.all(
        `SELECT * FROM rewards`,
        [],
        async (err, rows) => {

            if (!rows || rows.length === 0) {

                return i.editReply({
                    content: '❌ No hay rewards activas'
                });
            }

            const menu = new StringSelectMenuBuilder()
                .setCustomId('select_reward_winners')
                .setPlaceholder('Seleccionar reward');

            rows.forEach(r => {

                menu.addOptions({
                    label: r.name,
                    description: `${r.required_hours}h`,
                    value: String(r.id)
                });
            });

            const row = new ActionRowBuilder()
                .addComponents(menu);

            await i.editReply({
                content: '🏆 Selecciona una reward',
                components: [row]
            });
        }
    );
}

// ================= ENTREGAR DESDE MENU =================

if (i.customId === 'select_entregar_reward') {

    const data = i.values[0];

    const [userId, rewardName] =
        data.split('|');

    db.run(
        `INSERT INTO reward_winners
        (user_id, reward_name, date)
        VALUES (?, ?, ?)`,

        [
            userId,
            rewardName,
            new Date().toLocaleString(
                'es-UY',
                {
                    timeZone:
                        'America/Montevideo'
                }
            )
        ],

        async () => {

            try {

                const rewardChannel =
                    await client.channels.fetch(
                        REWARD_CHANNEL_ID
                    );

                const embed =
                    new EmbedBuilder()
                        .setColor(0x00ff00)
                        .setTitle(
                            '🏆 Reward Entregado'
                        )
                        .setDescription(
`👤 Usuario:
<@${userId}>

🎁 Reward:
${rewardName}

✅ Reward entregado automáticamente`
                        )
                        .setFooter({
                            text:
                                `Entregado por ${i.user.tag}`
                        })
                        .setTimestamp();

                await rewardChannel.send({
                    embeds: [embed]
                });

            } catch (e) {

                console.log(
                    '❌ Error anunciando reward:',
                    e
                );
            }

            await i.reply({
                content:
                    '✅ Reward entregado correctamente',
                flags: 64
            });
        }
    );

    return;
}

// ================= ENVIAR GANADORES =================

if (i.customId === 'select_reward_winners') {

    const id = i.values[0];

    db.get(
        `SELECT * FROM rewards WHERE id=?`,
        [id],

        async (err, rewardData) => {

            if (!rewardData) {

                return i.reply({
                    content:
                        '❌ Reward no encontrada',
                    flags: 64
                });
            }

            db.all(
                `SELECT * FROM sessions
                WHERE created_at >= ?`,
                [rewardData.created_at],

                async (err, sessions) => {

                    const totals = {};

                    sessions.forEach(session => {

                        if (
                            !totals[
                                session.user_id
                            ]
                        ) {

                            totals[
                                session.user_id
                            ] = 0;
                        }

                        totals[
                            session.user_id
                        ] += session.duration;
                    });

                    const winners = [];

                    Object.keys(totals)
                        .forEach(userId => {

                            const hours =
                                Math.floor(
                                    totals[userId]
                                    / 3600
                                );

                            if (
                                hours >=
                                rewardData.required_hours
                            ) {

                                winners.push({
                                    userId,
                                    hours
                                });
                            }
                        });

                    const channel =
                        await client.channels.fetch(
                            REWARD_WINNERS_CHANNEL_ID
                        );

                    let txt =
`🏆 **Ganadores de Reward**

🏅 ${rewardData.name}

🎁 Premio:
${rewardData.reward}

✅ Ganadores:

`;

                    if (
                        winners.length === 0
                    ) {

                        txt +=
                            '❌ Nadie completó la reward';

                    } else {

                        winners.forEach(w => {

                            txt +=
`• <@${w.userId}> - ${w.hours}h
`;
                        });
                    }

                    await channel.send({
                        content: txt
                    });

                    await i.editReply({
                        content:
                            '✅ Ganadores enviados'
                    });
                }
            );
        }
    );
}

// ================= ELIMINAR REWARD =================

if (i.customId === 'select_delete_reward') {

    const id = i.values[0];

    db.get(
        `SELECT * FROM rewards WHERE id=?`,
        [id],

        async (err, rewardData) => {

            if (!rewardData) {

                return i.reply({
                    content:
                        '❌ Reward no encontrada',
                    flags: 64
                });
            }

            db.run(
                `UPDATE rewards
                SET active = 0
                WHERE id=?`,

                [id],

                async () => {

                    try {

                        const rewardChannel =
                            await client.channels.fetch(
                                REWARD_CHANNEL_ID
                            );

                        const embed =
                            new EmbedBuilder()
                                .setColor(0xff0000)
                                .setTitle(
                                    '📦 Recompensa Finalizada'
                                )
                                .setDescription(
`🏅 **${rewardData.name}**

🎁 Premio:
${rewardData.reward}

⏱️ Horas requeridas:
${rewardData.required_hours}h

📌 Esta recompensa ya no se encuentra disponible.`
                                )
                                .setFooter({
                                    text:
                                        'SAME - MEDICA URUGUAYA'
                                })
                                .setTimestamp();

                        await rewardChannel.send({
                            content:
                                `<@&${REWARD_ROLE_ID}>`,
                            embeds: [embed]
                        });

                    } catch (e) {

                        console.log(
                            '❌ Error enviando finalización reward:',
                            e
                        );
                    }

                    await i.reply({
                        content:
                            '✅ Recompensa finalizada',
                        flags: 64
                    });
                }
            );
        }
    );
}

});
// ================= RESUMEN DIARIO =================

async function enviarResumenSemanalDiario() {

    const week = getWeek();

    db.all(
        `SELECT * FROM weekly_time
        WHERE week=?
        ORDER BY total_time DESC`,
        [week],
        async (err, rows) => {

            if (!rows || rows.length === 0) return;

            for (let i = 0; i < rows.length; i++) {

                const r = rows[i];

                const pos = i + 1;

                const top = rows[0];

                const diff = top.total_time - r.total_time;

                try {

                    const user = await client.users.fetch(r.user_id);

                    await user.send(
`📊 Resumen semanal

⏱️ Total acumulado: ${formatTime(r.total_time)}
📍 Posición: #${pos}

🥇 Top 1: ${formatTime(top.total_time)}

${pos !== 1
? `📉 Diferencia con el top: ${formatTime(diff)}`
: '🔥 Actualmente sos el #1'
}

💪 Seguís sumando horas`
                    );

                } catch {}
            }
        }
    );
}

// ================= CRON SEMANAL =================

cron.schedule('0 22 * * 0', async () => {

    console.log('🟡 Ejecutando cron semanal');

    try {

        const topCh = await client.channels.fetch(TOP_CHANNEL_ID);

        const listCh = await client.channels.fetch(LIST_CHANNEL_ID);

        const guild = await client.guilds.fetch(GUILD_ID);

        const members = await guild.members.fetch();

        const week = getWeek();

        db.all(
            `SELECT user_id, total_time
            FROM weekly_time
            WHERE week=?`,
            [week],
            async (err, rows) => {

                if (err) {
                    console.log(err);
                    return;
                }

                rows = rows || [];

                const map = new Map();

                rows.forEach(r => {

                    map.set(r.user_id, r.total_time);
                });

                let lista = [];

                members.forEach(member => {

                    if (member.user.bot) return;

                    if (!member.roles.cache.has(ROLE_ID)) return;

                    const tiempo = map.get(member.id) || 0;

                    lista.push({
                        id: member.id,
                        tiempo
                    });
                });

                lista.sort((a, b) => b.tiempo - a.tiempo);

                // LISTADO
                let full =
`📊 **Listado de Horas Semanales — ${formatDate()}**

`;

                lista.forEach((u, i) => {

                    if (u.tiempo > 0) {

                        full += `**${i + 1}.** <@${u.id}> — \`${formatTime(u.tiempo)}\`\n`;

                    } else {

                        full += `**${i + 1}.** <@${u.id}> — ❌ Inactivo (0h)\n`;
                    }
                });

                full += `\n📈 _Los miembros que no cumplieron con el minimo de horas semanales, podran ser sancionados dependiendo cada caso!_`;

                await listCh.send(full);

                // TOP 5
                const activos = lista
                    .filter(x => x.tiempo > 0)
                    .slice(0, 5);

                const medals = [
                    '🥇',
                    '🥈',
                    '🥉',
                    '🏅',
                    '🏅'
                ];

                let topTxt =
`🏆 **Ranking Semanal — ${formatDate()}**

`;

                if (activos.length === 0) {

                    topTxt += '❌ No hubo actividad esta semana';

                } else {

                    activos.forEach((r, i) => {

                        topTxt += `${medals[i]} **#${i + 1}** <@${r.id}> — \`${formatTime(r.tiempo)}\`\n`;
                    });
                }

                topTxt += `\n✨ _Felicidades por integrar el TOP de horas, recorda ABRIR TICKET para reclamar tu bono!_`;

                await topCh.send(topTxt);

                // reset semanal
                db.run(`DELETE FROM weekly_time`);

                console.log('🗑️ Horas semanales reseteadas');

                console.log('✅ Ranking semanal enviado');
            }
        );

    } catch (err) {

        console.log('❌ Error cron semanal:', err);
    }

}, {
    timezone: 'America/Montevideo'
});

// ================= CRON DIARIO =================


// ================= READY =================

client.once('clientReady', async () => {

    console.log(`✅ Bot listo como ${client.user.tag}`);

    const guild =
        await client.guilds.fetch(
            GUILD_ID
        );

    // ================= COMANDOS =================

    await guild.commands.create(
        new SlashCommandBuilder()
            .setName('perfil')
            .setDescription(
                'Ver tu perfil SAME'
            )
    );

    await guild.commands.create(
        new SlashCommandBuilder()
            .setName('historial')
            .setDescription(
                'Ver historial administrativo'
            )
            .addUserOption(option =>
                option
                    .setName('usuario')
                    .setDescription(
                        'Usuario a consultar'
                    )
                    .setRequired(true)
            )
    );
await guild.commands.create(
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription(
            'Reenviar panel principal'
        )
);

    // ================= SESIONES ACTIVAS =================

    db.all(
        `SELECT * FROM active_sessions`,
        [],
        (err, rows) => {

            rows.forEach(r => {

                activeUsers.add(r.user_id);

                sessionTime.set(r.user_id, {
                    start: r.start_time
                });
            });
        }
    );
});

client.on('interactionCreate', async i => {

    if (!i.isChatInputCommand()) return;

    if (i.commandName === 'perfil') {

        if (
            !i.member.roles.cache.has(
                ROLE_ID
            )
        ) {

            return i.reply({
                content:
                    '❌ No tienes permisos',
                flags: 64
            });

        }

      const week = getWeek();

db.get(
    `SELECT * FROM weekly_time
    WHERE user_id=? AND week=?`,
    [i.user.id, week],
    async (err, row) => {

        db.all(
            `SELECT * FROM sanctions
            WHERE user_id=?`,
            [i.user.id],
            async (err, sanctions) => {

                        const warns =
                            sanctions.filter(
                                s =>
                                    s.type ===
                                    'warn'
                            ).length;

                        const strikes =
                            sanctions.filter(
                                s =>
                                    s.type ===
                                    'strike'
                            ).length;

                        const embed =
                            new EmbedBuilder()
                                .setColor(
                                    0x00bfff
                                )
                                .setTitle(
                                    `📋 Perfil de ${i.user.username}`
                                )
                                .addFields(
                                    {
                                        name:
                                            '⏱️ Horas semanales',
                                        value:
                                            row
                                                ? formatTime(
                                                      row.total_time
                                                  )
                                                : '00:00:00',
                                        inline: true
                                    },
                                    {
                                        name:
                                            '⚠️ Warns',
                                        value:
                                            String(
                                                warns
                                            ),
                                        inline: true
                                    },
                                    {
                                        name:
                                            '🚨 Strikes',
                                        value:
                                            String(
                                                strikes
                                            ),
                                        inline: true
                                    }
                                )
                                .setFooter({
                                    text:
                                        'SAME - MEDICA URUGUAYA'
                                })
                                .setTimestamp();

                        await i.reply({
                            embeds: [embed],
                            flags: 64
                        });
                    }
                );
            }
        );
    }
});

client.on('interactionCreate', async i => {

    if (!i.isChatInputCommand()) return;

    if (i.commandName !== 'historial') return;

    try {

        if (
            !i.member.roles.cache.has(
                ADMIN_ROLE_ID
            )
        ) {

            return i.reply({
                content:
                    '❌ No tienes permisos',
                flags: 64
            });
        }

        const user =
            i.options.getUser(
                'usuario'
            );

        db.all(
            `SELECT * FROM admin_history
            WHERE user_id=?
            ORDER BY id DESC`,
            [user.id],
            async (err, historyRows) => {

                if (err) {

                    console.log(err);

                    return i.reply({
                        content:
                            '❌ Error cargando historial',
                        flags: 64
                    });
                }

                db.all(
                    `SELECT * FROM sanctions
                    WHERE user_id=?
                    ORDER BY id DESC`,
                    [user.id],
                    async (err, sanctionsRows) => {

                        let txt =
`📋 Historial Administrativo

👤 Usuario:
${user.username}

━━━━━━━━━━━━━━━━━━

`;

                        // ================= ADMIN HISTORY =================

                        if (
                            historyRows &&
                            historyRows.length > 0
                        ) {

                            historyRows.forEach(r => {

                                txt +=
`📌 ${r.action}
👮 Admin: <@${r.admin_id}>
📅 ${r.date}

`;
                            });
                        }

                        // ================= SANCIONES =================

                        if (
                            sanctionsRows &&
                            sanctionsRows.length > 0
                        ) {

                            txt +=
`━━━━━━━━━━━━━━━━━━

⚠️ SANCIONES

`;

                            sanctionsRows.forEach(r => {

                                txt +=
`📌 ${r.type.toUpperCase()}
📝 ${r.reason}

👮 Admin:
<@${r.admin_id}>

📅 ${r.date}

`;
                            });
                        }

                        await i.reply({
                            content:
                                txt.slice(0, 1900),
                            flags: 64
                        });
                    }
                );
            }
        );

    } catch (err) {

        console.log(err);

        if (!i.replied) {

            await i.reply({
                content:
                    '❌ Error ejecutando comando',
                flags: 64
            });
        }
    }
});
client.on('interactionCreate', async i => {

    if (!i.isChatInputCommand()) return;

    if (i.commandName !== 'panel') return;

    if (
        !i.member.roles.cache.has(
            ADMIN_ROLE_ID
        )
    ) {

        return i.reply({
            content:
                '❌ No tienes permisos',
            flags: 64
        });
    }

    try {

        await enviarPanel();

await enviarPanelPostulacion();

        await i.reply({
            content:
                '✅ Panel enviado',
            flags: 64
        });

    } catch (err) {

        console.log(err);

        await i.reply({
            content:
                '❌ Error enviando panel',
            flags: 64
        });
    }
});

// ================= LOGIN =================

client.login(TOKEN);