import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, projects, generatedContent, templates, InsertGeneratedContent } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserProjects(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projects).where(eq(projects.userId, userId));
}

export async function getProjectById(projectId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createProject(
  userId: number,
  name: string,
  description: string | null,
  contentType: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(projects).values({
    userId,
    name,
    description,
    contentType,
  });
  return result;
}

export async function getProjectContent(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(generatedContent).where(eq(generatedContent.projectId, projectId));
}

export async function createGeneratedContent(
  projectId: number,
  title: string,
  content: string,
  prompt: string,
  templateId?: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(generatedContent).values({
    projectId,
    templateId,
    title,
    content,
    prompt,
    status: "draft",
  });
  return result;
}

export async function getContentById(contentId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(generatedContent)
    .where(eq(generatedContent.id, contentId))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateGeneratedContent(
  contentId: number,
  updates: Partial<InsertGeneratedContent>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .update(generatedContent)
    .set(updates)
    .where(eq(generatedContent.id, contentId));
}

export async function getTemplates() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(templates).where(eq(templates.isPublic, 1));
}

export async function getTemplatesByType(contentType: string) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(templates)
    .where((t) => eq(t.contentType, contentType) && eq(t.isPublic, 1));
}
