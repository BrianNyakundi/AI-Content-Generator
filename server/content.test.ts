import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

// Mock the database functions
vi.mock("./db", () => ({
  getUserProjects: vi.fn(),
  getProjectById: vi.fn(),
  createProject: vi.fn(),
  getProjectContent: vi.fn(),
  createGeneratedContent: vi.fn(),
  getContentById: vi.fn(),
  updateGeneratedContent: vi.fn(),
  getTemplates: vi.fn(),
  getTemplatesByType: vi.fn(),
}));

// Mock the LLM function
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: "This is AI-generated content for testing purposes.",
        },
      },
    ],
  }),
}));

function createAuthContext(userId: number = 1): TrpcContext {
  const user: User = {
    id: userId,
    openId: `test-user-${userId}`,
    email: `test${userId}@example.com`,
    name: `Test User ${userId}`,
    loginMethod: "test",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("Content Generation Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("projects.list", () => {
    it("should list user projects", async () => {
      const ctx = createAuthContext(1);
      const mockProjects = [
        {
          id: 1,
          userId: 1,
          name: "Blog Project",
          description: "Test blog",
          contentType: "blog",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const { getUserProjects } = await import("./db");
      vi.mocked(getUserProjects).mockResolvedValue(mockProjects);

      const caller = appRouter.createCaller(ctx);
      const result = await caller.projects.list();

      expect(result).toEqual(mockProjects);
      expect(getUserProjects).toHaveBeenCalledWith(1);
    });
  });

  describe("projects.create", () => {
    it("should create a new project", async () => {
      const ctx = createAuthContext(1);
      const { createProject } = await import("./db");
      vi.mocked(createProject).mockResolvedValue({ insertId: 1 } as any);

      const caller = appRouter.createCaller(ctx);
      const result = await caller.projects.create({
        name: "New Project",
        description: "Test description",
        contentType: "blog",
      });

      expect(result).toEqual({ success: true });
      expect(createProject).toHaveBeenCalledWith(
        1,
        "New Project",
        "Test description",
        "blog"
      );
    });

    it("should fail without required fields", async () => {
      const ctx = createAuthContext(1);
      const caller = appRouter.createCaller(ctx);

      try {
        await caller.projects.create({
          name: "",
          contentType: "blog",
        });
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.code).toBe("BAD_REQUEST");
      }
    });
  });

  describe("content.generate", () => {
    it("should generate content successfully", async () => {
      const ctx = createAuthContext(1);
      const { getProjectById, createGeneratedContent } = await import("./db");
      const { invokeLLM } = await import("./_core/llm");

      const mockProject = {
        id: 1,
        userId: 1,
        name: "Test Project",
        description: null,
        contentType: "blog",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(getProjectById).mockResolvedValue(mockProject);
      vi.mocked(createGeneratedContent).mockResolvedValue({ insertId: 1 } as any);
      vi.mocked(invokeLLM).mockResolvedValue({
        choices: [
          {
            message: {
              content: "Generated blog post content",
            },
          },
        ],
      });

      const caller = appRouter.createCaller(ctx);
      const result = await caller.content.generate({
        projectId: 1,
        title: "Test Blog Post",
        prompt: "Write about AI",
        tone: "professional",
        length: "medium",
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe("Generated blog post content");
      expect(invokeLLM).toHaveBeenCalled();
      expect(createGeneratedContent).toHaveBeenCalled();
    });

    it("should fail if project not found", async () => {
      const ctx = createAuthContext(1);
      const { getProjectById } = await import("./db");
      vi.mocked(getProjectById).mockResolvedValue(undefined);

      const caller = appRouter.createCaller(ctx);

      try {
        await caller.content.generate({
          projectId: 999,
          title: "Test",
          prompt: "Test prompt",
        });
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.code).toBe("FORBIDDEN");
      }
    });

    it("should fail if user doesn't own the project", async () => {
      const ctx = createAuthContext(1);
      const { getProjectById } = await import("./db");

      const mockProject = {
        id: 1,
        userId: 2, // Different user
        name: "Test Project",
        description: null,
        contentType: "blog",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(getProjectById).mockResolvedValue(mockProject);

      const caller = appRouter.createCaller(ctx);

      try {
        await caller.content.generate({
          projectId: 1,
          title: "Test",
          prompt: "Test prompt",
        });
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.code).toBe("FORBIDDEN");
      }
    });
  });

  describe("content.update", () => {
    it("should update content successfully", async () => {
      const ctx = createAuthContext(1);
      const { updateGeneratedContent } = await import("./db");
      vi.mocked(updateGeneratedContent).mockResolvedValue({} as any);

      const caller = appRouter.createCaller(ctx);
      const result = await caller.content.update({
        id: 1,
        content: "Updated content",
        title: "Updated Title",
        status: "published",
      });

      expect(result.success).toBe(true);
      expect(updateGeneratedContent).toHaveBeenCalledWith(1, {
        content: "Updated content",
        title: "Updated Title",
        status: "published",
      });
    });
  });

  describe("content.regenerate", () => {
    it("should regenerate content with new prompt", async () => {
      const ctx = createAuthContext(1);
      const { getContentById, getProjectById, updateGeneratedContent } = await import("./db");
      const { invokeLLM } = await import("./_core/llm");

      const mockContent = {
        id: 1,
        projectId: 1,
        templateId: null,
        title: "Test",
        content: "Old content",
        prompt: "Old prompt",
        status: "draft" as const,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockProject = {
        id: 1,
        userId: 1,
        name: "Test Project",
        description: null,
        contentType: "blog",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.mocked(getContentById).mockResolvedValue(mockContent);
      vi.mocked(getProjectById).mockResolvedValue(mockProject);
      vi.mocked(invokeLLM).mockResolvedValue({
        choices: [
          {
            message: {
              content: "Regenerated content",
            },
          },
        ],
      });
      vi.mocked(updateGeneratedContent).mockResolvedValue({} as any);

      const caller = appRouter.createCaller(ctx);
      const result = await caller.content.regenerate({
        id: 1,
        prompt: "New prompt",
        tone: "casual",
      });

      expect(result.success).toBe(true);
      expect(result.content).toBe("Regenerated content");
      expect(updateGeneratedContent).toHaveBeenCalledWith(1, {
        content: "Regenerated content",
        prompt: "New prompt",
        version: 2,
      });
    });
  });

  describe("templates.list", () => {
    it("should list all public templates", async () => {
      const mockTemplates = [
        {
          id: 1,
          name: "Blog Template",
          description: "For blog posts",
          contentType: "blog",
          systemPrompt: "You are a blog writer",
          placeholders: '["title", "topic"]',
          isPublic: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const { getTemplates } = await import("./db");
      vi.mocked(getTemplates).mockResolvedValue(mockTemplates);

      const ctx = createAuthContext(1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.templates.list();

      expect(result).toEqual(mockTemplates);
      expect(getTemplates).toHaveBeenCalled();
    });
  });

  describe("templates.listByType", () => {
    it("should list templates by content type", async () => {
      const mockTemplates = [
        {
          id: 1,
          name: "Blog Template",
          description: "For blog posts",
          contentType: "blog",
          systemPrompt: "You are a blog writer",
          placeholders: '["title", "topic"]',
          isPublic: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const { getTemplatesByType } = await import("./db");
      vi.mocked(getTemplatesByType).mockResolvedValue(mockTemplates);

      const ctx = createAuthContext(1);
      const caller = appRouter.createCaller(ctx);
      const result = await caller.templates.listByType({ contentType: "blog" });

      expect(result).toEqual(mockTemplates);
      expect(getTemplatesByType).toHaveBeenCalledWith("blog");
    });
  });
});
