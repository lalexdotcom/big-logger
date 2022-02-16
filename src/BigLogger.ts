import type StackTrace from "stacktrace-js";
import type { Chalk } from "chalk";
import type { inspect } from "util";
import { rootCertificates } from "tls";
import { Cipher } from "crypto";

const inNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;
const inBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";

let stacktrace: typeof StackTrace | undefined;
try {
	stacktrace = require(`${"stacktrace-js"}`);
} catch {}

let chalk: Chalk;
if (inNode) {
	try {
		chalk = require(`${"chalk"}`);
	} catch (e) {}
}

let utilInspect: typeof inspect;
if (inNode) {
	try {
		utilInspect = require(`${"util"}`)?.inspect;
	} catch (e) {}
}

type LogParameters = Parameters<typeof console.log>;

export enum LogLevel {
	EMERGENCY = 0,
	ALERT = 1,
	CRITICAL = 2,
	ERROR = 3,
	WARNING = 4,
	NOTICE = 5,
	INFO = 6,
	VERBOSE = 7,
	DEBUG = 8,
	WHO_CARES = 9,
}

interface GenericLogger {
	log(level: LogLevel, ...args: LogParameters): void;

	emerg(...args: LogParameters): void;
	alert(...args: LogParameters): void;
	crit(...args: LogParameters): void;
	error(...args: LogParameters): void;
	warn(...args: LogParameters): void;
	notice(...args: LogParameters): void;
	info(...args: LogParameters): void;
	verb(...args: LogParameters): void;
	debug(...args: LogParameters): void;
	wth(...args: LogParameters): void;
}

type LoggerOptions = {
	enabled: boolean;
	stack: boolean;
	date: boolean;
	time: boolean;
	level: LogLevel | undefined;
	pad: boolean;
};

export interface Logger extends GenericLogger, LoggerOptions {
	exclusive: boolean;

	once(key?: string): GenericLogger;
	limit(count: number, key?: string): GenericLogger;
}

export interface RootLogger extends Logger {
	scope(scopeName: string, options?: Partial<LoggerOptions>): ScopeLogger;
}

export interface ScopeLogger extends Logger {
	readonly scope: string;
}

interface LimitedLogger extends Logger {
	reset(): void;
}

type LoggerRegistry = {
	root: RootLoggerInstance;
	scopes: { [key: string]: ScopeLoggerInstance | undefined };
	exclusive?: Logger;
};

const DEFAULT_LOGGER_OPTIONS: LoggerOptions = {
	enabled: true,
	level: undefined,

	stack: false,
	date: false,
	time: false,
	pad: inNode,
};

abstract class LoggerBase implements Logger {
	options: LoggerOptions;
	lastLog?: number;

	#limits: { [key: string]: GenericLogger } = {};

	#limitedProxy(count: number): GenericLogger {
		let proxyCount = 0;
		return new Proxy(this, {
			get(target, prop) {
				if (prop == "log" && ++proxyCount > count) return () => {};
				return target[prop as keyof typeof target];
			},
		});
	}

	constructor(options: Partial<LoggerOptions> = {}) {
		this.options = { ...DEFAULT_LOGGER_OPTIONS, ...options };
	}

	once(key?: string): GenericLogger {
		return this.limit(1, key);
	}

	limit(count: number, key?: string): GenericLogger {
		if (key === undefined) {
			if (!stacktrace) {
				this.warn("stacktrace-js must be present for limiting features without key");
			} else {
				let stack = stacktrace.getSync();
				const caller = stack?.[1];
				if (caller) {
					key = `${caller.fileName}:${caller.lineNumber}:${caller.columnNumber}`;
				}
			}
		}
		if (key === undefined) {
			throw new Error("Invalid key");
		} else {
			return (this.#limits[key] ??= this.#limitedProxy(count));
		}
		// throw new Error("Method not implemented.");
	}

	log(level: LogLevel, ...args: LogParameters): void {
		outputLog(level, args, this);
	}

	emerg(...args: LogParameters) {
		return this.log(LogLevel.EMERGENCY, ...args);
	}
	alert(...args: LogParameters) {
		return this.log(LogLevel.ALERT, ...args);
	}
	crit(...args: LogParameters) {
		return this.log(LogLevel.CRITICAL, ...args);
	}
	error(...args: LogParameters) {
		return this.log(LogLevel.ERROR, ...args);
	}
	warn(...args: LogParameters) {
		return this.log(LogLevel.WARNING, ...args);
	}
	notice(...args: LogParameters) {
		return this.log(LogLevel.NOTICE, ...args);
	}
	info(...args: LogParameters) {
		return this.log(LogLevel.INFO, ...args);
	}
	verb(...args: LogParameters) {
		return this.log(LogLevel.VERBOSE, ...args);
	}
	debug(...args: LogParameters) {
		return this.log(LogLevel.DEBUG, ...args);
	}
	wth(...args: LogParameters) {
		return this.log(LogLevel.WHO_CARES, ...args);
	}

	get exclusive() {
		return registry.exclusive == this;
	}

	set exclusive(b: boolean) {
		registry.exclusive = this.exclusive ? undefined : this;
	}

	protected setOption<K extends keyof LoggerOptions>(key: K, value: LoggerOptions[K]) {
		this.options[key] = value;
	}

	protected getOption<K extends keyof LoggerOptions>(key: K) {
		return this.options[key];
	}

	get enabled() {
		return this.getOption("enabled");
	}

	set enabled(b: boolean) {
		this.setOption("enabled", b);
	}

	get stack() {
		return this.getOption("stack");
	}

	set stack(b: boolean) {
		this.setOption("stack", b);
	}

	get date() {
		return this.getOption("date");
	}

	set date(b: boolean) {
		this.setOption("date", b);
	}

	get time() {
		return this.getOption("time");
	}

	set time(b: boolean) {
		this.setOption("time", b);
	}

	get level() {
		return this.getOption("level");
	}

	set level(lvl: LogLevel | undefined) {
		this.setOption("level", lvl);
	}

	get pad() {
		return this.getOption("pad");
	}

	set pad(b: boolean) {
		this.setOption("pad", b);
	}
}

class RootLoggerInstance extends LoggerBase implements RootLogger {
	scope(scopeName: string, options: Partial<LoggerOptions> = {}): ScopeLogger {
		let scopeLogger = registry.scopes[scopeName];
		scopeLogger ??= registry.scopes[scopeName] = new ScopeLoggerInstance(scopeName, this, options);
		return scopeLogger;
	}
}

class ScopeLoggerInstance extends LoggerBase implements ScopeLogger {
	readonly scope: string;
	readonly parent: RootLogger;

	constructor(scope: string, root: RootLoggerInstance, options?: Partial<LoggerOptions>) {
		super(options);
		this.scope = scope;
		this.parent = root;
	}

	log(level: LogLevel, ...args: LogParameters): void {
		outputLog(level, args, this, this.scope);
	}
}

type LogLevelStyle = {
	backgroundColor: string;
	color: string;
};

const DEFAULT_LEVEL_STYLE: LogLevelStyle = {
	backgroundColor: "grey",
	color: "white",
};

const DEFAULT_BROWSER_STYLE = {
	padding: "2px 4px",
	"border-radius": "2px",
};

type LogLevelParam = {
	label: string;
	paddedLabel?: string;
	methods: typeof console.log[];
	style?: Partial<LogLevelStyle>;
	css?: string;
};

const LEVEL_PARAMS: { [key in LogLevel]: LogLevelParam } = {
	[LogLevel.EMERGENCY]: {
		label: "EMERGENCY",
		methods: [console.error, console.trace],
		style: {
			backgroundColor: "red",
		},
	},
	[LogLevel.ALERT]: {
		label: "ALERT",
		methods: [console.error, console.trace],
		style: {
			backgroundColor: "red",
		},
	},
	[LogLevel.CRITICAL]: {
		label: "CRITICAL",
		methods: [console.error, console.trace],
		style: {
			backgroundColor: "red",
		},
	},
	[LogLevel.ERROR]: {
		label: "ERROR",
		methods: [console.error],
		style: {
			backgroundColor: "red",
		},
	},
	[LogLevel.WARNING]: {
		label: "WARNING",
		methods: [console.warn],
		style: {
			color: "white",
			backgroundColor: "orange",
		},
	},
	[LogLevel.NOTICE]: {
		label: "NOTICE",
		methods: [console.info],
		style: {
			backgroundColor: "blue",
		},
	},
	[LogLevel.INFO]: {
		label: "INFO",
		methods: [console.info],
	},
	[LogLevel.VERBOSE]: {
		label: "VERBOSE",
		methods: [console.debug],
		style: {
			backgroundColor: "green",
		},
	},
	[LogLevel.DEBUG]: {
		label: "DEBUG",
		methods: [console.debug],
		style: {
			backgroundColor: "yellow",
			color: "black",
		},
	},
	[LogLevel.WHO_CARES]: {
		label: "WHO CARES?",
		methods: [console.debug],
		style: {
			backgroundColor: "lightgray",
			color: "black",
		},
	},
};

if (inNode) {
	const padSize = Math.max(...Object.values(LEVEL_PARAMS).map(info => info.label.length));
	for (const lvl of Object.values(LEVEL_PARAMS)) {
		lvl.paddedLabel = lvl.label
			.padEnd(lvl.label.length + (padSize - lvl.label.length) / 2, " ")
			.padStart(padSize, " ");
	}
}
for (const lvl of Object.values(LEVEL_PARAMS)) {
	lvl.style = { ...DEFAULT_LEVEL_STYLE, ...lvl.style };
	if (inBrowser) {
		lvl.css = css(lvl.style);
	}
}

// Constants

// export const LEVEL_STYLES = ObjectUtils.map(levelStyles, (styl: LogLevelStyle) => {
//     const fullStyle = { ...DEFAULT_LEVEL_STYLE, ...styl };
//     return {
//         style: fullStyle,
//         css: inBrowser ? css(fullStyle) : undefined,
//     };
// });

function css(style: Partial<LogLevelStyle>) {
	// const style = LEVEL_STYLES[level];

	const STYLE_MAP: { [key in keyof Partial<LogLevelStyle>]: string } = {
		backgroundColor: "background-color",
	};

	const cssObject: Record<string, unknown> = { ...DEFAULT_BROWSER_STYLE };
	for (const [styleKey, styleValue] of Object.entries(style)) {
		const cssKey = STYLE_MAP[<keyof LogLevelStyle>styleKey] || styleKey;
		cssObject[cssKey] = styleValue;
	}

	return Object.entries(cssObject)
		.map(([key, value]) => `${key}: ${value}`)
		.join(";");
}

const computeOptions = (logger: LoggerBase) => {
	const computed = { ...logger.options },
		root = registry.root;
	for (const [key, value] of Object.entries(computed)) {
		switch (key) {
			case "level":
				computed[key] =
					root.level === undefined
						? computed.level
						: computed.level === undefined
						? root.level
						: Math.min(root.level, computed.level);
				break;
			case "date":
			case "time":
			case "pad":
			case "stack":
				computed[key] ||= root[key];
				break;
		}
	}
	return computed;
};

const outputLog = (logLevel: LogLevel, args: LogParameters, logger: LoggerBase, prefix?: string) => {
	if (registry.exclusive && registry.exclusive !== logger) return;
	if (!logger.enabled || !root.enabled) return;

	const { date, time, level, pad, stack } = computeOptions(logger);

	if (!LEVEL_PARAMS[logLevel]) return;
	if (level && level < logLevel) return;
	const levelParams = LEVEL_PARAMS[logLevel];

	let levelPrefix = (pad && levelParams.paddedLabel) || levelParams.label;
	if (prefix) levelPrefix += ` <${prefix}>`;

	let logPrefix: string[] = [levelPrefix];
	if (inNode) {
		if (chalk) {
			let colorize = chalk;
			if (levelParams.style?.color) colorize = colorize.keyword(levelParams.style.color);
			if (levelParams.style?.backgroundColor) colorize = colorize.bgKeyword(levelParams.style.backgroundColor);
			logPrefix = [colorize(` ${levelPrefix} `)];
		} else {
			logPrefix = [`[${levelPrefix}]`];
		}
	} else if (inBrowser) {
		logPrefix = [`%c${levelPrefix}`, levelParams.css!];
	}

	if (time || date) {
		if (time) logger.lastLog ??= new Date().valueOf();
		let now: Date = new Date();
		if (date) {
			const datePrefix =
				"[" +
				now.getFullYear() +
				"-" +
				`${now.getMonth() + 1}`.padStart(2, "0") +
				"-" +
				`${now.getDate()}`.padStart(2, "0") +
				" " +
				`${now.getHours()}`.padStart(2, "0") +
				":" +
				`${now.getMinutes()}`.padStart(2, "0") +
				":" +
				`${now.getSeconds()}`.padStart(2, "0") +
				"." +
				`${(now.getMilliseconds() / 1000).toFixed(3).slice(2, 5)}`.padStart(2, "0") +
				"]";
			logPrefix.push(datePrefix);
		}
		if (time) {
			const timePrefix = `[+${((now.valueOf() - logger.lastLog!) / 1000).toFixed(3)}s]`;
			logger.lastLog = new Date().valueOf();
			logPrefix.push(timePrefix);
		}

		if (stack && stacktrace) {
			const st = stacktrace.getSync();
			const fName = st[3]?.functionName || st[3]?.fileName?.split("/").pop();
			if (fName) logPrefix.push(`<${fName}>`);
		}
	}

	levelParams.methods.map(method => method.apply(globalThis, [...logPrefix, ...args]));

	// console.log(`(${levelParams.paddedLabel || levelParams.label}${prefix ? ' ' + prefix : ''})`, ...args);
};

const registry = (() => {
	if (typeof globalThis === "undefined") throw new Error("No globalThis found");
	const anyGlobal = globalThis as any,
		registryName = "$big-l-registry";
	if (!anyGlobal[registryName]) {
		const emptyRegistry: LoggerRegistry = { root: new RootLoggerInstance(), scopes: {} };
		anyGlobal[registryName] = emptyRegistry;
	}
	return anyGlobal[registryName] as LoggerRegistry;
})();

const root = registry.root;

export const Logger: RootLogger = root;
