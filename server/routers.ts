import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { invokeLLM } from "./_core/llm";
import {
  getUserProjects,
  getProjectById,
  createProject,
  getProjectContent,
  createGeneratedContent,
  getContentById,
  updateGeneratedContent,
  getTemplates,
  getTemplatesByType,
} from "./db";
import { TRPCError } from "@trpc/server";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  projects: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return await getUserProjects(ctx.user.id);
    }),

    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          contentType: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await createProject(
          ctx.user.id,
          input.name,
          input.description || null,
          input.contentType
        );
        return { success: true };
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await getProjectById(input.id);
      }),
  }),

  content: router({
    listByProject: protectedProcedure
      .input(z.object({ projectId: z.number() }))
      .query(async ({ input }) => {
        return await getProjectContent(input.projectId);
      }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return await getContentById(input.id);
      }),

    generate: protectedProcedure
      .input(
        z.object({
          projectId: z.number(),
          title: z.string().min(1),
          prompt: z.string().min(1),
          templateId: z.number().optional(),
          tone: z.string().optional(),
          length: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // Verify project ownership
        const project = await getProjectById(input.projectId);
        if (!project || project.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Project not found or access denied",
          });
        }

        // Build system prompt
        let systemPrompt = `You are an expert content creator. Generate high-quality ${project.contentType} content.`;
        if (input.tone) systemPrompt += ` Use a ${input.tone} tone.`;
        if (input.length) systemPrompt += ` Keep it ${input.length}.`;

        // Generate content using LLM
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: input.prompt,
            },
          ],
        });

        const messageContent = response.choices[0]?.message.content;
        const generatedText = typeof messageContent === "string" ? messageContent : "No content generated";

        // Save to database
        await createGeneratedContent(
          input.projectId,
          input.title,
          generatedText,
          input.prompt,
          input.templateId
        );

        return {
          success: true,
          content: generatedText,
        };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          content: z.string().optional(),
          title: z.string().optional(),
          status: z.enum(["draft", "published", "archived"]).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const updates: Record<string, unknown> = {};
        if (input.content !== undefined) updates.content = input.content;
        if (input.title !== undefined) updates.title = input.title;
        if (input.status !== undefined) updates.status = input.status;

        await updateGeneratedContent(input.id, updates);
        return { success: true };
      }),

    regenerate: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          prompt: z.string().min(1),
          tone: z.string().optional(),
          length: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const content = await getContentById(input.id);
        if (!content) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Content not found",
          });
        }

        const project = await getProjectById(content.projectId);
        if (!project || project.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Access denied",
          });
        }

        // Build system prompt
        let systemPrompt = `You are an expert content creator. Generate high-quality ${project.contentType} content.`;
        if (input.tone) systemPrompt += ` Use a ${input.tone} tone.`;
        if (input.length) systemPrompt += ` Keep it ${input.length}.`;

        // Generate new content
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: input.prompt,
            },
          ],
        });

        const messageContent = response.choices[0]?.message.content;
        const generatedText = typeof messageContent === "string" ? messageContent : "No content generated";

        // Update content
        await updateGeneratedContent(input.id, {
          content: generatedText,
          prompt: input.prompt,
          version: content.version + 1,
        });

        return {
          success: true,
          content: generatedText,
        };
      }),
  }),

  templates: router({
    list: publicProcedure.query(async () => {
      return await getTemplates();
    }),

    listByType: publicProcedure
      .input(z.object({ contentType: z.string() }))
      .query(async ({ input }) => {
        return await getTemplatesByType(input.contentType);
      }),
  }),
});

export type AppRouter = typeof appRouter;
