//
// Imports
//

import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import archiver from "archiver";
import mysql2 from "mysql2/promise.js";

//
// Locals
//

type GetTableNamesOptions =
{
	databaseUrl: URL;
	filterTableNames: string[];
	filterTableNamesMode: "exclude" | "include";
};

async function getTableNames(options: GetTableNamesOptions)
{
	const { databaseUrl, filterTableNames, filterTableNamesMode } = options;

	const connection = await mysql2.createConnection(
		{
			uri: databaseUrl.toString(),
			dateStrings: true,
		});

	const databaseName = databaseUrl.pathname.substring(1);

	const [ rawTableRows ] = await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?;`,
		[
			databaseName,
		]) as unknown as [ { TABLE_NAME : string }[] ];

	connection.end();

	const allTableNames = rawTableRows.map(rawTableRow => rawTableRow.TABLE_NAME);

	switch (filterTableNamesMode)
	{
		case "exclude":
			return allTableNames.filter((tableName) => !filterTableNames.includes(tableName));

		case "include":
			return allTableNames.filter((tableName) => filterTableNames.includes(tableName));
	}
}

type DumpTableStructureOptions =
{
	mysqlDumpPath: string;
	databaseUrl: URL;
	tableName: string;
	outputPath: string;
};

async function dumpTableStructure(options: DumpTableStructureOptions)
{
	const { mysqlDumpPath, databaseUrl, tableName, outputPath } = options;

	const commandComponents =
	[
		`"${ mysqlDumpPath }"`,
		`--host ${ databaseUrl.hostname }`,
		`--port ${ databaseUrl.port }`,
		`--user ${ databaseUrl.username }`,
		`--password=${ databaseUrl.password }`,
		`--no-data`,
		`--set-gtid-purged=OFF`,
		`--single-transaction`,
		`--no-tablespaces`,
		`--skip-add-drop-table`,
		databaseUrl.pathname.substring(1),
		tableName,
		`> "${ outputPath }"`,
	];

	return new Promise<void>((resolve, reject) => child_process.exec(commandComponents.join(" "),
		(error) =>
		{
			if (error != null)
			{
				reject(error);
			}

			resolve();
		}));
}

type DumpTableDataOptions =
{
	mysqlDumpPath: string;
	databaseUrl: URL;
	tableName: string;
	outputPath: string;
};

async function dumpTableData(options: DumpTableDataOptions)
{
	const { mysqlDumpPath, databaseUrl, tableName, outputPath } = options;

	const commandComponents =
	[
		`"${ mysqlDumpPath }"`,
		`--host ${ databaseUrl.hostname }`,
		`--port ${ databaseUrl.port }`,
		`--user ${ databaseUrl.username }`,
		`--password=${ databaseUrl.password }`,
		`--no-create-info`,
		`--set-gtid-purged=OFF`,
		`--single-transaction`,
		`--no-tablespaces`,
		databaseUrl.pathname.substring(1),
		tableName,
		`> "${ outputPath }"`,
	];

	return new Promise<void>((resolve, reject) => child_process.exec(commandComponents.join(" "),
		(error) =>
		{
			if (error != null)
			{
				reject(error);
			}

			resolve();
		}));
}

type CreateArchiveOptions =
{
	outputDirectory: string;
	directories:
	{
		name: string;
		path: string;
	}[];
};

async function createArchive(options: CreateArchiveOptions)
{
	const { outputDirectory, directories } = options;

	const tarFileName = path.join(outputDirectory, "dump.tar");
	const tarWriteStream = fs.createWriteStream(tarFileName);
	const tarArchive = archiver("tar");
	tarArchive.pipe(tarWriteStream);

	for (const directory of directories)
	{
		tarArchive.directory(directory.path, directory.name);
	}

	await tarArchive.finalize();

	const tarReadStream = fs.createReadStream(tarFileName);
	const gzip = zlib.createGzip();
	const gzipFileName = tarFileName + ".gz";
	const gzipWriteSteam = fs.createWriteStream(gzipFileName);

	return new Promise<string>((resolve, reject) => tarReadStream
		.pipe(gzip)
		.pipe(gzipWriteSteam)
		.on("error", () => reject())
		.on("finish", () => resolve(gzipFileName)));
}

//
// Types
//

export type DumpStep =
{
	type: "removingOldOutputDirectory";
} |
{
	type: "creatingNewOutputDirectories";
} |
{
	type: "gettingTableNames";
} |
{
	type: "dumpingTables";
	tableNames: string[];
} |
{
	type: "dumpingTable";
	tableName: string;
} |
{
	type: "creatingArchive";
};

//
// Utility Functions
//

export type DumpAndArchiveMySqlDatabaseOptions =
{
	databaseUrl: URL;
	filterTableNames?: string[];
	filterTableNamesMode?: "exclude" | "include";

	mysqlDumpPath: string;
	onStep?: (step: DumpStep) => Promise<void>;
	outputPath: string;
};

export type DumpAndArchiveMySqlDatabaseResult =
{
	success: false;
	error: Error | null;
} |
{
	success: true;
	tableNames: string[];
	archiveFilePath: string;
	startTimestamp: number;
	endTimestamp: number;
	duration: number;
};

export async function dumpAndArchiveMySqlDatabase(options: DumpAndArchiveMySqlDatabaseOptions): Promise<DumpAndArchiveMySqlDatabaseResult>
{
	const databaseUrl = options.databaseUrl;
	const filterTableNames = options.filterTableNames ?? [];
	const filterTableNamesMode = options.filterTableNamesMode ?? "exclude";
	const mysqlDumpPath = options.mysqlDumpPath;
	const onStep = options.onStep ?? (async () => {});
	const outputPath = options.outputPath;


	try
	{
		const startDate = new Date();

		await onStep({ type: "removingOldOutputDirectory" });

		await fs.promises.rm(outputPath, { recursive: true, force: true });

		await onStep({ type: "creatingNewOutputDirectories" });

		await fs.promises.mkdir(path.join(outputPath, "data"), { recursive: true });
		await fs.promises.mkdir(path.join(outputPath, "structure"), { recursive: true });

		await onStep({ type: "gettingTableNames" });

		const tableNames = await getTableNames({ databaseUrl, filterTableNames, filterTableNamesMode });

		await onStep({ type: "dumpingTables", tableNames });

		for (const tableName of tableNames)
		{
			await onStep({ type: "dumpingTable", tableName });

			await dumpTableStructure(
				{
					databaseUrl,
					outputPath: path.join(outputPath, "data", tableName + ".sql"),
					mysqlDumpPath,
					tableName,
				});

			await dumpTableData(
				{
					databaseUrl,
					outputPath: path.join(outputPath, "structure", tableName + ".sql"),
					mysqlDumpPath,
					tableName,
				});
		}

		await onStep({ type: "creatingArchive" });

		const archiveFilePath = await createArchive(
			{
				outputDirectory: outputPath,
				directories:
				[
					{ name: "data", path: path.join(outputPath, "data") },
					{ name: "structure", path: path.join(outputPath, "structure") },
				],
			});

		const endDate = new Date();

		const startTimestamp = Math.floor(startDate.getTime() / 1000);
		const endTimestamp = Math.floor(endDate.getTime() / 1000);
		const duration = endTimestamp - startTimestamp;

		return {
			success: true,
			tableNames,
			archiveFilePath,
			startTimestamp,
			endTimestamp,
			duration,
		};
	}
	catch (error)
	{
		return {
			success: false,
			error: error instanceof Error ? error : null,
		};
	}
}