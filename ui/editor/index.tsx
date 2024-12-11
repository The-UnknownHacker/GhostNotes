"use client";
import { toast } from "sonner";
import { useCompletion } from "ai/react";
import { useDebouncedCallback } from "use-debounce";
import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import va from "@vercel/analytics";
import { supabase } from '@/lib/supabaseClient';
import { useRouter } from "next/navigation";

import { EditorBubbleMenu } from "@/ui/editor/components";
import { getPrevText } from "@/lib/editor";
import { TiptapEditorProps } from "@/ui/editor/props";
import { TiptapExtensions } from "@/ui/editor/extensions";
import DEFAULT_EDITOR_CONTENT from "@/ui/editor/default-content";
import useLocalStorage from "@/lib/hooks/use-local-storage";

export default function Editor() {
  const router = useRouter();
  const [content, setContent] = useLocalStorage(
    "content",
    DEFAULT_EDITOR_CONTENT,
  );
  const [saveStatus, setSaveStatus] = useState("Saved");
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState(null);

  const loadSavedNotes = async (userId: string) => {
    const { data: notes, error } = await supabase
      .from('notes')
      .select('content')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (error) {
      console.error('Error loading notes:', error);
      return;
    }

    if (notes) {
      setContent(notes.content);
      if (editor) {
        editor.commands.setContent(notes.content);
      }
    }
  };

  const editor = useEditor({
    extensions: TiptapExtensions,
    editorProps: TiptapEditorProps,
    content: content,
    onUpdate: (e) => {
      setSaveStatus("Unsaved");
      const selection = e.editor.state.selection;
      const lastTwo = getPrevText(e.editor, {
        chars: 2,
      });

      if (lastTwo === "++" && !isLoading) {
        e.editor.commands.deleteRange({
          from: selection.from - 2,
          to: selection.from,
        });
        complete(getPrevText(e.editor, { chars: 5000 }));
        va.track("Autocomplete Shortcut Used");
      } else if (lastTwo === "--" && !isLoading) {
        e.editor.commands.deleteRange({
          from: selection.from - 2,
          to: selection.from,
        });
        summarize(getPrevText(e.editor, { chars: 5000 }));
        va.track("Summarize Shortcut Used");
      } else {
        debouncedUpdates(e);
      }
    },
    autofocus: "end",
  });

  // Load saved notes when editor is ready
  useEffect(() => {
    if (editor && user) {
      loadSavedNotes(user.id);
    }
  }, [editor, user]);

  // Handle authentication
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error('Error fetching session:', error);
        router.push('/login');
      } else if (session) {
        setUser(session.user);
      } else {
        router.push('/login');
      }
    };

    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session) {
          setUser(session.user);
        } else {
          setUser(null);
          router.push('/login');
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

  const saveNoteToSupabase = async (content) => {
    if (!user) {
      console.error('User not logged in');
      return;
    }

    // First try to update existing note
    const { data: existingNotes, error: fetchError } = await supabase
      .from('notes')
      .select('id')
      .eq('user_id', user.id)
      .limit(1);

    if (fetchError) {
      console.error('Error fetching notes:', fetchError);
      return;
    }

    if (existingNotes && existingNotes.length > 0) {
      // Update existing note
      const { data, error } = await supabase
        .from('notes')
        .update({ content })
        .eq('id', existingNotes[0].id)
        .select();

      if (error) console.error('Error updating note:', error);
      else console.log('Note updated:', data);
    } else {
      // Insert new note
      const { data, error } = await supabase
        .from('notes')
        .insert([{ 
          user_id: user.id, 
          content 
        }])
        .select();

      if (error) console.error('Error saving note:', error);
      else console.log('Note saved:', data);
    }
  };

  const debouncedUpdates = useDebouncedCallback(async ({ editor }) => {
    const json = editor.getJSON();
    setSaveStatus("Saving...");
    setContent(json);
    await saveNoteToSupabase(json);
    // Simulate a delay in saving.
    setTimeout(() => {
      setSaveStatus("Saved");
    }, 500);
  }, 750);

  const { complete, completion, isLoading, stop } = useCompletion({
    id: "notepad-autocomplete",
    api: "/api/generate",
    onFinish: (_prompt, completion) => {
      editor?.commands.setTextSelection({
        from: editor.state.selection.from - completion.length,
        to: editor.state.selection.from,
      });
    },
    onError: (err) => {
      toast.error(err.message);
      if (err.message === "You have reached your request limit for the day.") {
        va.track("Rate Limit Reached");
      }
    },
  });

  const { complete: summarize, isLoading: isSummarizing } = useCompletion({
    id: "notepad-summarize",
    api: "/api/summarize",
    onFinish: (_prompt, summary) => {
      editor?.commands.insertContent(summary);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const prev = useRef("");

  // Insert chunks of the generated text for autocompletion
  useEffect(() => {
    const diff = completion.slice(prev.current.length);
    prev.current = completion;
    editor?.commands.insertContent(diff);
  }, [isLoading, editor, completion]);

  // Hydrate the editor with the content from localStorage.
  useEffect(() => {
    if (editor && content && !hydrated) {
      editor.commands.setContent(content);
      setHydrated(true);
    }
  }, [editor, content, hydrated]);

  return (
    <div
      onClick={() => {
        editor?.chain().focus().run();
      }}
      className="relative min-h-[500px] w-full max-w-screen-lg border-stone-200 bg-white p-12 px-8 sm:mb-[calc(20vh)] sm:rounded-lg sm:border sm:px-12 sm:shadow-lg"
    >
      <div className="absolute right-5 top-5 mb-5 rounded-lg bg-stone-100 px-2 py-1 text-sm text-stone-400">
        {saveStatus}
      </div>
      {editor && <EditorBubbleMenu editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
